import SwiftUI

/// Pure black with an inset amber edge glow and one amber dot near the
/// bottom. This is all a customer sees.
struct RecordingScreen: View {
    var body: some View {
        ZStack {
            Theme.black.ignoresSafeArea()
            Rectangle()
                .inset(by: -10)
                .stroke(Theme.amber.opacity(0.6), lineWidth: 40)
                .blur(radius: 24)
                .ignoresSafeArea()
            VStack {
                Spacer()
                ZStack {
                    Circle()
                        .fill(Theme.amber.opacity(0.7))
                        .frame(width: 26, height: 26)
                        .blur(radius: 12)
                    Circle()
                        .fill(Theme.amber)
                        .frame(width: 14, height: 14)
                }
                .padding(.bottom, 60)
            }
            .ignoresSafeArea()
        }
        .clipped()
    }
}
