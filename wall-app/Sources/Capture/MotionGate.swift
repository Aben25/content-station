import CoreVideo
import Foundation

/// Motion detection per the contract: every 4th frame, 32x32 luma, mean
/// absolute difference against the previous sample above 6 means motion.
final class MotionGate {
    enum Verdict: Equatable {
        case skipped
        case still(Double)
        case motion(Double)
    }

    var everyNthFrame = 4
    var gridSize = 32
    var threshold: Double = 6

    private var frameIndex = 0
    private var previous: [UInt8]?
    private(set) var lastMotionAt: Date?
    private(set) var lastEvaluationAt: Date?
    private(set) var lastSample: [UInt8]?

    func process(_ pixelBuffer: CVPixelBuffer, at date: Date) -> Verdict {
        frameIndex &+= 1
        guard frameIndex % everyNthFrame == 0 else { return .skipped }
        guard let sample = LumaSampler.sample(pixelBuffer, size: gridSize) else { return .skipped }
        lastEvaluationAt = date
        lastSample = sample
        defer { previous = sample }
        guard let previous else { return .still(0) }
        let difference = LumaSampler.meanAbsoluteDifference(sample, previous)
        if difference > threshold {
            lastMotionAt = date
            return .motion(difference)
        }
        return .still(difference)
    }

    /// Seconds since the last detected motion, or nil when never seen.
    func quietSeconds(at date: Date) -> TimeInterval? {
        guard let lastMotionAt else { return nil }
        return date.timeIntervalSince(lastMotionAt)
    }

    func reset() {
        frameIndex = 0
        previous = nil
        lastMotionAt = nil
        lastSample = nil
    }
}
