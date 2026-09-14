import CoreVideo
import Foundation

/// Compares a 64x64 luma of the current frame to the reference captured at
/// framing. Checks every five minutes in a quiet window. Drift is three
/// consecutive checks with a mean absolute difference above 28.
final class DriftDetector {
    var gridSize = 64
    var checkInterval: TimeInterval = 5 * 60
    var threshold: Double = 28
    var requiredConsecutive = 3
    /// The frame must have been still for at least this long.
    var quietWindow: TimeInterval = 10

    private(set) var reference: [UInt8]?
    private(set) var consecutiveExceeded = 0
    private(set) var isDrifted = false
    private var lastCheckAt: Date?

    private let fileURL: URL

    init(directory: URL) {
        fileURL = directory.appendingPathComponent("reference.luma")
        if let data = try? Data(contentsOf: fileURL), data.count == gridSize * gridSize {
            reference = [UInt8](data)
        }
    }

    var hasReference: Bool { reference != nil }

    /// Stores the current frame as the reference and clears any drift.
    func setReference(from pixelBuffer: CVPixelBuffer) {
        guard let sample = LumaSampler.sample(pixelBuffer, size: gridSize) else { return }
        reference = sample
        consecutiveExceeded = 0
        isDrifted = false
        lastCheckAt = Date()
        try? Data(sample).write(to: fileURL, options: .atomic)
        Log.capture.info("reference frame stored")
    }

    func clearReference() {
        reference = nil
        consecutiveExceeded = 0
        isDrifted = false
        try? FileManager.default.removeItem(at: fileURL)
    }

    /// Clears the drift flag without touching the reference, used when the
    /// owner saves a new reference on the server before the local frame is
    /// replaced.
    func clearDrift() {
        consecutiveExceeded = 0
        isDrifted = false
    }

    /// Runs a check when due. Returns true when the drift flag changed.
    @discardableResult
    func check(_ pixelBuffer: CVPixelBuffer, quietFor quiet: TimeInterval?, now: Date) -> Bool {
        guard let reference else { return false }
        guard let quiet, quiet >= quietWindow else { return false }
        if let lastCheckAt, now.timeIntervalSince(lastCheckAt) < checkInterval { return false }
        guard let sample = LumaSampler.sample(pixelBuffer, size: gridSize) else { return false }
        lastCheckAt = now
        let difference = LumaSampler.meanAbsoluteDifference(sample, reference)
        let previous = isDrifted
        if difference > threshold {
            consecutiveExceeded += 1
            if consecutiveExceeded >= requiredConsecutive { isDrifted = true }
        } else {
            consecutiveExceeded = 0
            isDrifted = false
        }
        Log.capture.info("drift check diff=\(difference, privacy: .public) streak=\(self.consecutiveExceeded, privacy: .public)")
        return previous != isDrifted
    }
}
