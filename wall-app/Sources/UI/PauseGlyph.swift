import SwiftUI

/// Two light bars, the pause symbol.
struct PauseGlyph: View {
    var body: some View {
        HStack(spacing: 26) {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Theme.text)
                .frame(width: 34, height: Theme.glyphSize)
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Theme.text)
                .frame(width: 34, height: Theme.glyphSize)
        }
    }
}
