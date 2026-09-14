import CoreVideo
import Foundation

/// While framing, sends a JPEG at `Product.previewFps` per second with a
/// long edge of 960 px and quality 0.6.
final class PreviewStreamer {
    var framesPerSecond: Double = Double(Product.previewFps)
    var longEdge: CGFloat = 960
    var quality: CGFloat = 0.6
    var send: ((Data) -> Void)?
    var isActive = false

    private let encoder = JPEGEncoder()
    private var lastSentAt: Date?

    func offer(_ pixelBuffer: CVPixelBuffer, now: Date) {
        guard isActive, framesPerSecond > 0 else { return }
        let interval = 1 / framesPerSecond
        if let lastSentAt, now.timeIntervalSince(lastSentAt) < interval { return }
        guard let data = encoder.encode(pixelBuffer, longEdge: longEdge, quality: quality) else { return }
        lastSentAt = now
        send?(data)
    }
}
