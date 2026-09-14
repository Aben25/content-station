import CoreVideo
import Foundation

/// Downscales the luma plane of a 4:2:0 pixel buffer to a small square grid
/// by averaging sampled points inside each cell.
enum LumaSampler {
    static func sample(_ pixelBuffer: CVPixelBuffer, size: Int) -> [UInt8]? {
        guard size > 0, CVPixelBufferGetPlaneCount(pixelBuffer) >= 1 else { return nil }
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }

        guard let base = CVPixelBufferGetBaseAddressOfPlane(pixelBuffer, 0) else { return nil }
        let width = CVPixelBufferGetWidthOfPlane(pixelBuffer, 0)
        let height = CVPixelBufferGetHeightOfPlane(pixelBuffer, 0)
        let bytesPerRow = CVPixelBufferGetBytesPerRowOfPlane(pixelBuffer, 0)
        guard width >= size, height >= size else { return nil }

        let pointer = base.assumingMemoryBound(to: UInt8.self)
        let cellWidth = Double(width) / Double(size)
        let cellHeight = Double(height) / Double(size)
        let stepX = max(1, Int(cellWidth / 4))
        let stepY = max(1, Int(cellHeight / 4))

        var output = [UInt8](repeating: 0, count: size * size)
        for cellY in 0..<size {
            let y0 = Int(Double(cellY) * cellHeight)
            let y1 = max(y0 + 1, min(height, Int(Double(cellY + 1) * cellHeight)))
            for cellX in 0..<size {
                let x0 = Int(Double(cellX) * cellWidth)
                let x1 = max(x0 + 1, min(width, Int(Double(cellX + 1) * cellWidth)))
                var sum = 0
                var count = 0
                var y = y0
                while y < y1 {
                    let row = pointer + y * bytesPerRow
                    var x = x0
                    while x < x1 {
                        sum += Int(row[x])
                        count += 1
                        x += stepX
                    }
                    y += stepY
                }
                output[cellY * size + cellX] = UInt8(count > 0 ? sum / count : 0)
            }
        }
        return output
    }

    /// Mean absolute difference on the 0 to 255 scale.
    static func meanAbsoluteDifference(_ a: [UInt8], _ b: [UInt8]) -> Double {
        guard a.count == b.count, !a.isEmpty else { return 0 }
        var total = 0
        for index in 0..<a.count {
            total += abs(Int(a[index]) - Int(b[index]))
        }
        return Double(total) / Double(a.count)
    }
}
