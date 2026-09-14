import AVFoundation
import CoreMedia
import Foundation
import VideoToolbox

/// A finished MP4 on disk, ready for the upload queue.
struct SegmentFile: Codable, Equatable {
    var url: URL
    var startDate: Date
    var endDate: Date
    var width: Int
    var height: Int
    var fps: Int
    var bytes: Int
}

/// Encodes every frame with VideoToolbox so a three second pre roll of
/// compressed samples can sit in memory cheaply. When motion starts, the ring
/// is written to a fragmented MP4 through AVAssetWriter in passthrough mode,
/// and every later sample follows. Writing stops eight seconds after the last
/// motion, or rolls to a new file at the segment cap.
final class SegmentWriter {
    var preRollSeconds: TimeInterval = 3
    var stopAfterQuietSeconds: TimeInterval = 8
    var maxFileSeconds: TimeInterval = TimeInterval(Product.segmentMinutes * 60)
    var minFileSeconds: TimeInterval = 4
    var fps: Int = Product.captureFps
    var minimumFreeBytes: Int64 = 1_000_000_000

    var onSegmentFinished: ((SegmentFile) -> Void)?
    var onStorageFull: (() -> Void)?

    private let queue = DispatchQueue(label: "ai.contentstation.wall.segmentwriter")
    private let directory: URL

    private struct RingEntry {
        let sample: CMSampleBuffer
        let date: Date
        let isKeyframe: Bool
    }

    private var ring: [RingEntry] = []
    private var recordingEnabled = false

    private var encoder: VTCompressionSession?
    private var encoderWidth = 0
    private var encoderHeight = 0
    private var forceKeyframe = false

    private var writer: AVAssetWriter?
    private var input: AVAssetWriterInput?
    private var fileURL: URL?
    private var fileStartDate: Date?
    private var fileLastDate: Date?
    private var lastMotionDate: Date?
    private var pendingRoll = false

    private var secondsWrittenToday: TimeInterval = 0
    private var secondsDay: String = ""

    init(directory: URL) {
        self.directory = directory
        try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    }

    deinit {
        if let encoder {
            VTCompressionSessionInvalidate(encoder)
        }
    }

    // MARK: Public API, safe from any thread

    func setRecordingEnabled(_ enabled: Bool) {
        queue.async {
            self.recordingEnabled = enabled
            if !enabled { self.finishFile() }
        }
    }

    /// Feed every frame here. Encoding is asynchronous.
    func append(_ pixelBuffer: CVPixelBuffer, presentationTime: CMTime) {
        queue.async {
            self.encode(pixelBuffer, presentationTime: presentationTime)
        }
    }

    func motionDetected(at date: Date) {
        queue.async {
            self.lastMotionDate = date
            if self.recordingEnabled, self.writer == nil {
                self.startFile(fromRingIndex: self.firstKeyframeIndex())
            }
        }
    }

    /// Finish the current file, for example on thermal critical or shutdown.
    func stop(completion: (() -> Void)? = nil) {
        queue.async {
            self.finishFile()
            completion?()
        }
    }

    /// Seconds written to files today, for the heartbeat.
    func recordingSecondsToday(completion: @escaping (Int) -> Void) {
        queue.async {
            completion(Int(self.secondsWrittenToday))
        }
    }

    var isWriting: Bool {
        queue.sync { writer != nil }
    }

    // MARK: Encoder

    private func encode(_ pixelBuffer: CVPixelBuffer, presentationTime: CMTime) {
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        if encoder == nil || width != encoderWidth || height != encoderHeight {
            rebuildEncoder(width: width, height: height)
        }
        guard let encoder else { return }

        var properties: CFDictionary?
        if forceKeyframe {
            properties = [kVTEncodeFrameOptionKey_ForceKeyFrame: kCFBooleanTrue as Any] as CFDictionary
            forceKeyframe = false
        }
        var flags = VTEncodeInfoFlags()
        let status = VTCompressionSessionEncodeFrame(
            encoder,
            imageBuffer: pixelBuffer,
            presentationTimeStamp: presentationTime,
            duration: CMTime(value: 1, timescale: CMTimeScale(max(1, fps))),
            frameProperties: properties,
            sourceFrameRefcon: nil,
            infoFlagsOut: &flags
        )
        if status != noErr {
            Log.capture.error("encode failed \(status, privacy: .public)")
        }
    }

    private func rebuildEncoder(width: Int, height: Int) {
        // A format change ends the current file; passthrough inputs cannot
        // switch dimensions mid file.
        finishFile()
        ring.removeAll()
        if let encoder {
            VTCompressionSessionInvalidate(encoder)
            self.encoder = nil
        }
        var session: VTCompressionSession?
        let status = VTCompressionSessionCreate(
            allocator: nil,
            width: Int32(width),
            height: Int32(height),
            codecType: kCMVideoCodecType_H264,
            encoderSpecification: nil,
            imageBufferAttributes: nil,
            compressedDataAllocator: nil,
            outputCallback: segmentWriterOutputCallback,
            refcon: Unmanaged.passUnretained(self).toOpaque(),
            compressionSessionOut: &session
        )
        guard status == noErr, let session else {
            Log.capture.error("encoder create failed \(status, privacy: .public)")
            return
        }
        let bitrate = width * height >= 1920 * 1080 ? 8_000_000 : 4_000_000
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_RealTime, value: kCFBooleanTrue)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ProfileLevel, value: kVTProfileLevel_H264_High_AutoLevel)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AllowFrameReordering, value: kCFBooleanFalse)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_MaxKeyFrameInterval, value: fps as CFNumber)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_MaxKeyFrameIntervalDuration, value: 1 as CFNumber)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_AverageBitRate, value: bitrate as CFNumber)
        VTSessionSetProperty(session, key: kVTCompressionPropertyKey_ExpectedFrameRate, value: fps as CFNumber)
        VTCompressionSessionPrepareToEncodeFrames(session)
        encoder = session
        encoderWidth = width
        encoderHeight = height
        Log.capture.info("encoder ready \(width, privacy: .public)x\(height, privacy: .public)")
    }

    /// Called from the encoder thread.
    fileprivate func handleEncoded(_ sample: CMSampleBuffer) {
        queue.async {
            self.ingest(sample)
        }
    }

    private func ingest(_ sample: CMSampleBuffer) {
        let presentation = CMSampleBufferGetPresentationTimeStamp(sample)
        let date = SegmentWriter.date(fromHostTime: presentation)
        let keyframe = SegmentWriter.isKeyframe(sample)
        ring.append(RingEntry(sample: sample, date: date, isKeyframe: keyframe))
        trimRing()
        rollDayIfNeeded(date)

        if writer != nil {
            if pendingRoll, keyframe {
                finishFile()
                pendingRoll = false
                startFile(fromRingIndex: ring.count - 1)
                return
            }
            appendToFile(ring[ring.count - 1])
            if let lastMotionDate, date.timeIntervalSince(lastMotionDate) > stopAfterQuietSeconds {
                finishFile()
                return
            }
            if let fileStartDate, !pendingRoll, date.timeIntervalSince(fileStartDate) >= maxFileSeconds {
                pendingRoll = true
                forceKeyframe = true
            }
        }
    }

    private func trimRing() {
        guard let newest = ring.last else { return }
        let cutoff = newest.date.addingTimeInterval(-preRollSeconds)
        var keep = 0
        for (index, entry) in ring.enumerated() where entry.isKeyframe && entry.date <= cutoff {
            keep = index
        }
        if keep > 0 { ring.removeFirst(keep) }
        // Guard against an encoder that stops producing keyframes.
        let hardCutoff = newest.date.addingTimeInterval(-(preRollSeconds * 4))
        while let first = ring.first, first.date < hardCutoff, ring.count > 1 {
            ring.removeFirst()
        }
    }

    private func firstKeyframeIndex() -> Int {
        ring.firstIndex(where: { $0.isKeyframe }) ?? ring.count
    }

    // MARK: Files

    private func startFile(fromRingIndex index: Int) {
        guard recordingEnabled, writer == nil else { return }
        guard index >= 0, index < ring.count, ring[index].isKeyframe else {
            // No keyframe in the ring yet, the next keyframe starts the file.
            pendingRoll = true
            forceKeyframe = true
            return
        }
        guard UploadQueue.freeBytes() >= minimumFreeBytes else {
            Log.capture.error("refusing to record, free space under limit")
            onStorageFull?()
            return
        }
        let first = ring[index]
        guard let format = CMSampleBufferGetFormatDescription(first.sample) else { return }

        let name = "\(Int(first.date.timeIntervalSince1970 * 1000)).mp4"
        let url = directory.appendingPathComponent(name)
        try? FileManager.default.removeItem(at: url)
        do {
            let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
            writer.movieFragmentInterval = CMTime(seconds: 2, preferredTimescale: 600)
            let input = AVAssetWriterInput(mediaType: .video, outputSettings: nil, sourceFormatHint: format)
            input.expectsMediaDataInRealTime = true
            guard writer.canAdd(input) else {
                Log.capture.error("writer cannot add input")
                return
            }
            writer.add(input)
            guard writer.startWriting() else {
                Log.capture.error("writer start failed: \(writer.error?.localizedDescription ?? "unknown", privacy: .public)")
                return
            }
            writer.startSession(atSourceTime: CMSampleBufferGetPresentationTimeStamp(first.sample))
            self.writer = writer
            self.input = input
            fileURL = url
            fileStartDate = first.date
            fileLastDate = first.date
            pendingRoll = false
            for entry in ring[index...] {
                appendToFile(entry)
            }
            Log.capture.info("segment started \(name, privacy: .public)")
        } catch {
            Log.capture.error("writer create failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func appendToFile(_ entry: RingEntry) {
        guard let writer, let input, writer.status == .writing else { return }
        guard input.isReadyForMoreMediaData else {
            Log.capture.warning("writer not ready, dropping a sample")
            return
        }
        if input.append(entry.sample) {
            fileLastDate = entry.date
        } else {
            Log.capture.error("append failed: \(writer.error?.localizedDescription ?? "unknown", privacy: .public)")
            finishFile()
        }
    }

    private func finishFile() {
        guard let writer, let input, let url = fileURL else { return }
        let start = fileStartDate ?? Date()
        let end = fileLastDate ?? start
        let width = encoderWidth
        let height = encoderHeight
        let fps = self.fps
        self.writer = nil
        self.input = nil
        fileURL = nil
        fileStartDate = nil
        fileLastDate = nil
        pendingRoll = false

        guard writer.status == .writing else {
            try? FileManager.default.removeItem(at: url)
            return
        }
        input.markAsFinished()
        writer.finishWriting { [weak self] in
            guard let self else { return }
            self.queue.async {
                self.completed(url: url, start: start, end: end, width: width, height: height, fps: fps, error: writer.error)
            }
        }
    }

    private func completed(url: URL, start: Date, end: Date, width: Int, height: Int, fps: Int, error: Error?) {
        let duration = end.timeIntervalSince(start)
        if let error {
            Log.capture.error("segment failed: \(error.localizedDescription, privacy: .public)")
            try? FileManager.default.removeItem(at: url)
            return
        }
        guard duration >= minFileSeconds else {
            Log.capture.info("segment under \(self.minFileSeconds, privacy: .public) s, discarded")
            try? FileManager.default.removeItem(at: url)
            return
        }
        let bytes = (try? FileManager.default.attributesOfItem(atPath: url.path)[.size] as? Int) ?? 0
        secondsWrittenToday += duration
        let file = SegmentFile(url: url, startDate: start, endDate: end, width: width, height: height, fps: fps, bytes: bytes)
        Log.capture.info("segment finished \(url.lastPathComponent, privacy: .public) \(Int(duration), privacy: .public) s \(bytes, privacy: .public) bytes")
        onSegmentFinished?(file)
    }

    private func rollDayIfNeeded(_ date: Date) {
        let formatter = DateFormatter()
        formatter.dateFormat = "yyyy-MM-dd"
        let day = formatter.string(from: date)
        if day != secondsDay {
            secondsDay = day
            secondsWrittenToday = 0
        }
    }

    // MARK: Helpers

    private static func isKeyframe(_ sample: CMSampleBuffer) -> Bool {
        guard let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, createIfNecessary: false) as? [[CFString: Any]],
              let first = attachments.first else { return true }
        if let notSync = first[kCMSampleAttachmentKey_NotSync] as? Bool {
            return !notSync
        }
        return true
    }

    /// Camera timestamps are on the host clock, so the wall clock date of a
    /// sample is now minus its age.
    static func date(fromHostTime time: CMTime) -> Date {
        let hostNow = CMClockGetTime(CMClockGetHostTimeClock())
        let age = CMTimeGetSeconds(CMTimeSubtract(hostNow, time))
        guard age.isFinite else { return Date() }
        return Date().addingTimeInterval(-age)
    }
}

/// C callback for VideoToolbox. Hands the sample to the writer.
private let segmentWriterOutputCallback: VTCompressionOutputCallback = { refcon, _, status, flags, sampleBuffer in
    guard let refcon, status == noErr, let sampleBuffer else { return }
    if flags.contains(.frameDropped) { return }
    guard CMSampleBufferDataIsReady(sampleBuffer) else { return }
    let writer = Unmanaged<SegmentWriter>.fromOpaque(refcon).takeUnretainedValue()
    writer.handleEncoded(sampleBuffer)
}
