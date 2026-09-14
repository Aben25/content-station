import CoreMedia
import CoreVideo
import Foundation

/// Routes frames from the camera to the motion gate, segment writer, drift
/// detector, thumbnail service, and preview streamer depending on intent.
final class CapturePipeline {
    let motionGate = MotionGate()
    let segmentWriter: SegmentWriter
    let driftDetector: DriftDetector
    let thumbnails = ThumbnailService()
    let previews = PreviewStreamer()

    /// Called on the frame queue when the drift flag changes.
    var onDriftChanged: ((Bool) -> Void)?

    private let lock = NSLock()
    private var intent: CaptureIntent = .off
    private var captureReferenceOnNextFrame = false

    init(segmentsDirectory: URL, supportDirectory: URL) {
        segmentWriter = SegmentWriter(directory: segmentsDirectory)
        driftDetector = DriftDetector(directory: supportDirectory)
    }

    func setIntent(_ newIntent: CaptureIntent) {
        lock.lock()
        let previous = intent
        intent = newIntent
        lock.unlock()
        guard previous != newIntent else { return }
        previews.isActive = (newIntent == .framing)
        if newIntent == .recording {
            motionGate.reset()
        }
        segmentWriter.setRecordingEnabled(newIntent == .recording)
    }

    /// Store the next frame as the drift reference.
    func captureReferenceFrame() {
        lock.lock()
        captureReferenceOnNextFrame = true
        lock.unlock()
    }

    func clearDrift() {
        driftDetector.clearDrift()
    }

    func handle(_ pixelBuffer: CVPixelBuffer, presentationTime: CMTime, date: Date) {
        lock.lock()
        let current = intent
        let wantsReference = captureReferenceOnNextFrame
        captureReferenceOnNextFrame = false
        lock.unlock()

        if wantsReference {
            driftDetector.setReference(from: pixelBuffer)
            onDriftChanged?(false)
        }

        switch current {
        case .off, .waiting:
            return
        case .framing:
            previews.offer(pixelBuffer, now: date)
            thumbnails.offer(pixelBuffer, now: date)
        case .idle:
            thumbnails.offer(pixelBuffer, now: date)
        case .recording:
            segmentWriter.append(pixelBuffer, presentationTime: presentationTime)
            let verdict = motionGate.process(pixelBuffer, at: date)
            switch verdict {
            case .motion:
                segmentWriter.motionDetected(at: date)
            case .still:
                let quiet = motionGate.quietSeconds(at: date) ?? .greatestFiniteMagnitude
                if driftDetector.check(pixelBuffer, quietFor: quiet, now: date) {
                    onDriftChanged?(driftDetector.isDrifted)
                }
            case .skipped:
                break
            }
            thumbnails.offer(pixelBuffer, now: date)
        }
    }
}
