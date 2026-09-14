import AVFoundation
import SwiftUI

/// Live camera preview with the amber guide box and the "Adjust from your
/// phone" line. Falls back to a striped placeholder when there is no camera.
struct FramingScreen: View {
    let session: AVCaptureSession?

    var body: some View {
        GeometryReader { proxy in
            let scaleX = proxy.size.width / Theme.designWidth
            let scaleY = proxy.size.height / Theme.designHeight
            ZStack {
                Theme.black
                if let session {
                    CameraPreviewView(session: session)
                } else {
                    StripedPlaceholder()
                }
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .strokeBorder(Theme.amber, lineWidth: 3)
                    .padding(.leading, 36 * scaleX)
                    .padding(.trailing, 36 * scaleX)
                    .padding(.top, 200 * scaleY)
                    .padding(.bottom, 250 * scaleY)
                VStack {
                    Spacer()
                    Text("Adjust from your phone")
                        .font(.system(size: 34, weight: .semibold))
                        .foregroundStyle(Theme.text)
                        .multilineTextAlignment(.center)
                        .lineSpacing(34 * 0.15)
                        .frame(maxWidth: .infinity)
                        .padding(.bottom, 120 * scaleY)
                }
            }
        }
        .ignoresSafeArea()
    }
}

/// The footage placeholder from the design: diagonal stripes.
struct StripedPlaceholder: View {
    var body: some View {
        GeometryReader { proxy in
            let size = max(proxy.size.width, proxy.size.height) * 2
            ZStack {
                Theme.stripeDark
                HStack(spacing: 0) {
                    ForEach(0..<Int(size / 28) + 1, id: \.self) { _ in
                        Theme.stripeLight.frame(width: 14)
                        Theme.stripeDark.frame(width: 14)
                    }
                }
                .frame(width: size, height: size)
                .rotationEffect(.degrees(45))
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .clipped()
        }
    }
}
