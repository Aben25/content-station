import SwiftUI

/// Picks the view for a glyph.
struct GlyphView: View {
    let glyph: Glyph
    let code: String

    var body: some View {
        switch glyph {
        case .code: CodeGlyph(code: code)
        case .dot: DotGlyph()
        case .ring: RingGlyph()
        case .pause: PauseGlyph()
        case .off: OffGlyph()
        case .frame: FrameGlyph()
        case .hot: HotGlyph()
        case .fault: FaultGlyph()
        case .bar: BarGlyph()
        }
    }
}
