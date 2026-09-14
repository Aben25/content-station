import SwiftUI

/// The generic full screen layout: black background, one glyph, one line at
/// 44pt, an optional second line at 28pt.
struct StateScreen: View {
    let copy: StateCopy

    var body: some View {
        ZStack {
            Theme.black.ignoresSafeArea()
            VStack(spacing: Theme.glyphTextGap) {
                if let glyph = copy.glyph {
                    GlyphView(glyph: glyph, code: copy.code)
                }
                VStack(spacing: Theme.lineGap) {
                    if !copy.line1.isEmpty {
                        Text(copy.line1)
                            .font(.system(size: Theme.lineOneSize, weight: .semibold))
                            .foregroundStyle(Theme.text)
                            .lineSpacing(Theme.lineOneSize * 0.12)
                    }
                    if !copy.line2.isEmpty {
                        Text(copy.line2)
                            .font(.system(size: Theme.lineTwoSize, weight: .regular))
                            .foregroundStyle(Theme.tertiary)
                            .lineSpacing(Theme.lineTwoSize * 0.3)
                    }
                }
                .multilineTextAlignment(.center)
            }
            .frame(maxWidth: .infinity)
            .padding(.horizontal, Theme.horizontalPadding)
        }
        .id(copy.glyph.map { "\($0)" } ?? "none")
    }
}
