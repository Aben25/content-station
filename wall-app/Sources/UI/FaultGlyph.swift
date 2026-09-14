import SwiftUI

/// Light ring with an exclamation mark, shown for faults.
struct FaultGlyph: View {
    var body: some View {
        ZStack {
            Circle()
                .strokeBorder(Theme.text, lineWidth: 10)
            Text("!")
                .font(.system(size: 72, weight: .bold))
                .foregroundStyle(Theme.text)
        }
        .frame(width: Theme.glyphSize, height: Theme.glyphSize)
    }
}
