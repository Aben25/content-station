import SwiftUI

/// Dashed grey ring, shown when there is no internet.
struct OffGlyph: View {
    var body: some View {
        Circle()
            .inset(by: 5)
            .stroke(Theme.dashed, style: StrokeStyle(lineWidth: 10, dash: [22, 16]))
            .frame(width: Theme.glyphSize, height: Theme.glyphSize)
    }
}
