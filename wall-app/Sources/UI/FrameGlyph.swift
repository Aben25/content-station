import SwiftUI

/// Tilted amber frame, shown when the camera moved.
struct FrameGlyph: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .strokeBorder(Theme.amber, lineWidth: 10)
            .frame(width: 130, height: 130)
            .rotationEffect(.degrees(9))
    }
}
