import SwiftUI

/// The four character short code shown while waiting. The design uses 112pt
/// with 0.12em tracking in Outfit; the system font is wider, so the code is
/// allowed to scale down until it fits the content width on one line.
struct CodeGlyph: View {
    let code: String

    var body: some View {
        Text(code)
            .font(.system(size: Theme.codeSize, weight: .bold))
            .monospacedDigit()
            .tracking(Theme.codeSize * 0.12)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .foregroundStyle(Theme.amber)
    }
}
