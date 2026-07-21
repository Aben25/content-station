import SwiftUI

/// The main station screen — the only screen staff interact with.
/// Live preview always visible, 9:16 capture-zone guide, big capture button,
/// red recording indicator, status footer.
struct StationView: View {
    @EnvironmentObject var camera: CameraController
    @EnvironmentObject var uploader: UploadQueue
    @EnvironmentObject var config: StationConfig

    @State private var showSetup = false

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()

            switch camera.state {
            case .unauthorized:
                permissionView
            default:
                stationView
            }
        }
        .task {
            await camera.configure()
            if !config.isConfigured { showSetup = true }
        }
        .sheet(isPresented: $showSetup) {
            SetupSheet()
        }
    }

    // MARK: - Station

    private var stationView: some View {
        VStack(spacing: 0) {
            Text("CONTENT STATION")
                .font(.headline.monospaced())
                .foregroundStyle(.white.opacity(0.8))
                .padding(.top, 12)

            ZStack {
                CameraPreviewView(session: camera.session)
                    .clipShape(RoundedRectangle(cornerRadius: 12))

                // 9:16 capture-zone guide
                RoundedRectangle(cornerRadius: 8)
                    .stroke(Color.white.opacity(0.7), style: StrokeStyle(lineWidth: 2, dash: [8]))
                    .aspectRatio(9.0 / 16.0, contentMode: .fit)
                    .padding(24)

                if case .recording = camera.state {
                    recordingOverlay
                }
                if case .countdown(let n) = camera.state {
                    Text("\(n)")
                        .font(.system(size: 120, weight: .bold, design: .rounded))
                        .foregroundStyle(.white)
                        .shadow(radius: 8)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)

            statusRow
                .padding(.top, 12)

            captureButton
                .padding(.vertical, 20)

            footer
                .padding(.bottom, 12)
        }
    }

    private var recordingOverlay: some View {
        VStack {
            HStack(spacing: 8) {
                Circle().fill(.red).frame(width: 12, height: 12)
                Text("RECORDING")
                    .font(.headline.monospaced())
                    .foregroundStyle(.white)
                Spacer()
                Text(camera.recordingSeconds, format: .number.precision(.fractionLength(1)))
                    .font(.headline.monospaced())
                    .foregroundStyle(.white)
            }
            .padding(10)
            .background(.black.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
            .padding(20)
            Spacer()
        }
    }

    @ViewBuilder
    private var statusRow: some View {
        Group {
            switch camera.state {
            case .ready:
                Label("READY", systemImage: "circle.fill")
                    .foregroundStyle(.green)
            case .countdown:
                Label("GET READY", systemImage: "timer")
                    .foregroundStyle(.yellow)
            case .recording:
                Label("RECORDING", systemImage: "record.circle")
                    .foregroundStyle(.red)
            case .saving:
                Label("SAVING…", systemImage: "arrow.down.doc")
                    .foregroundStyle(.orange)
            case .error(let message):
                Label(message, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
                    .lineLimit(1)
            case .unauthorized:
                EmptyView()
            }
        }
        .font(.subheadline.monospaced().bold())
    }

    private var captureButton: some View {
        Button {
            if case .recording = camera.state {
                camera.stopRecording()
            } else {
                camera.tapCapture()
            }
        } label: {
            ZStack {
                Circle()
                    .stroke(.white, lineWidth: 5)
                    .frame(width: 84, height: 84)
                if case .recording = camera.state {
                    RoundedRectangle(cornerRadius: 6)
                        .fill(.red)
                        .frame(width: 34, height: 34)
                } else {
                    Circle()
                        .fill(camera.state == .ready ? .red : .gray)
                        .frame(width: 66, height: 66)
                }
            }
        }
        .disabled(buttonDisabled)
        .accessibilityLabel(Text(isRecording ? "Stop" : "Capture Moment"))
    }

    private var isRecording: Bool {
        if case .recording = camera.state { return true }
        return false
    }

    private var buttonDisabled: Bool {
        switch camera.state {
        case .ready, .recording: return false
        default: return true
        }
    }

    private var footer: some View {
        HStack(spacing: 20) {
            Button {
                showSetup = true
            } label: {
                Label(config.isConfigured ? "Linked" : "Set up", systemImage: config.isConfigured ? "link" : "exclamationmark.triangle")
                    .foregroundStyle(config.isConfigured ? .green : .yellow)
            }
            Text("Uploads: \(uploader.pendingCount)")
                .foregroundStyle(.white.opacity(0.8))
            Spacer()
            if let last = camera.lastSavedURL {
                Text("Saved ✓ \(last.lastPathComponent.prefix(8))…")
                    .foregroundStyle(.white.opacity(0.5))
                    .lineLimit(1)
            }
        }
        .font(.caption.monospaced())
        .padding(.horizontal, 20)
    }

    // MARK: - Permissions

    private var permissionView: some View {
        VStack(spacing: 20) {
            Image(systemName: "camera.fill")
                .font(.system(size: 56))
                .foregroundStyle(.white)
            Text("Camera & Microphone Access Needed")
                .font(.title2.bold())
                .foregroundStyle(.white)
            Text("Content Station captures short videos of moments at your business. It needs camera access to record and microphone access for sound.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.white.opacity(0.8))
            Button("Open Settings") {
                if let url = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(url)
                }
            }
            .buttonStyle(.borderedProminent)
        }
        .padding(32)
    }
}

#Preview {
    StationView()
        .environmentObject(CameraController())
        .environmentObject(UploadQueue())
        .environmentObject(StationConfig())
        .preferredColorScheme(.dark)
}
