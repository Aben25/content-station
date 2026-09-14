import AVFoundation
import SwiftUI

/// Renders the current wall state. One full screen at a time, no touch
/// targets anywhere.
struct RootView: View {
    @ObservedObject var stateMachine: StateMachine
    let previewSession: AVCaptureSession?

    var body: some View {
        ZStack {
            Theme.black.ignoresSafeArea()
            switch stateMachine.displayState {
            case .recording:
                RecordingScreen()
            case .idle:
                Theme.black.ignoresSafeArea()
            case .framing:
                FramingScreen(session: previewSession)
            default:
                StateScreen(copy: stateMachine.copy)
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}
