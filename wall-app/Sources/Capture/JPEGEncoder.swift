import CoreImage
import CoreVideo
import Foundation
import ImageIO
import UniformTypeIdentifiers

/// Turns a pixel buffer into a JPEG scaled to a long edge.
final class JPEGEncoder {
    private let context = CIContext(options: [.useSoftwareRenderer: false])
    private let colorSpace = CGColorSpace(name: CGColorSpace.sRGB) ?? CGColorSpaceCreateDeviceRGB()

    func encode(_ pixelBuffer: CVPixelBuffer, longEdge: CGFloat, quality: CGFloat) -> Data? {
        var image = CIImage(cvPixelBuffer: pixelBuffer)
        let extent = image.extent
        let currentLongEdge = max(extent.width, extent.height)
        if currentLongEdge > longEdge, currentLongEdge > 0 {
            let scale = longEdge / currentLongEdge
            image = image.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
        }
        let options: [CIImageRepresentationOption: Any] = [
            kCGImageDestinationLossyCompressionQuality as CIImageRepresentationOption: quality,
        ]
        return context.jpegRepresentation(of: image, colorSpace: colorSpace, options: options)
    }
}
