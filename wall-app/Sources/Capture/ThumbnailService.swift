import CoreVideo
import Foundation

/// Produces one JPEG a minute with a long edge of 480 px and hands it to
/// `send`. The caller decides when frames are offered.
final class ThumbnailService {
    var interval: TimeInterval = 60
    var longEdge: CGFloat = 480
    var quality: CGFloat = 0.7
    var send: ((Data) -> Void)?

    private let encoder = JPEGEncoder()
    private var lastSentAt: Date?

    func offer(_ pixelBuffer: CVPixelBuffer, now: Date) {
        if let lastSentAt, now.timeIntervalSince(lastSentAt) < interval { return }
        guard let data = encoder.encode(pixelBuffer, longEdge: longEdge, quality: quality) else { return }
        lastSentAt = now
        send?(data)
    }

    func reset() {
        lastSentAt = nil
    }
}
