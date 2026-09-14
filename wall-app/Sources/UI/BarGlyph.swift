import SwiftUI

/// Progress bar shown while joining Wi-Fi. Fills from 12% to 78% over
/// three seconds with an ease out. Under reduced motion it sits at 78%.
struct BarGlyph: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var fraction: CGFloat = 0.12

    private let width: CGFloat = 220
    private let height: CGFloat = 14

    var body: some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: height / 2, style: .continuous)
                .fill(Theme.track)
            RoundedRectangle(cornerRadius: height / 2, style: .continuous)
                .fill(Theme.amber)
                .frame(width: width * (reduceMotion ? 0.78 : fraction))
        }
        .frame(width: width, height: height)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeOut(duration: 3)) {
                fraction = 0.78
            }
        }
    }
}
