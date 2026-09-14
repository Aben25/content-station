import SwiftUI

/// Amber core with a faint outer ring, shown while cooling down.
struct HotGlyph: View {
    var body: some View {
        ZStack {
            Circle()
                .strokeBorder(Theme.amber.opacity(0.35), lineWidth: 9)
                .frame(width: Theme.glyphSize, height: Theme.glyphSize)
            Circle()
                .fill(Theme.amber)
                .frame(width: 68, height: 68)
        }
        .frame(width: Theme.glyphSize, height: Theme.glyphSize)
    }
}
