import SwiftUI

/// Pulsing amber ring. The pulse stops under reduced motion.
struct RingGlyph: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var dimmed = false

    var body: some View {
        Circle()
            .strokeBorder(Theme.amber, lineWidth: 10)
            .frame(width: Theme.glyphSize, height: Theme.glyphSize)
            .opacity(reduceMotion ? 1 : (dimmed ? 0.55 : 1))
            .onAppear {
                guard !reduceMotion else { return }
                withAnimation(.easeInOut(duration: 0.8).repeatForever(autoreverses: true)) {
                    dimmed = true
                }
            }
    }
}
