import SwiftUI

/// Solid amber disc, shown for "Got it."
struct DotGlyph: View {
    var body: some View {
        Circle()
            .fill(Theme.amber)
            .frame(width: Theme.glyphSize, height: Theme.glyphSize)
    }
}
