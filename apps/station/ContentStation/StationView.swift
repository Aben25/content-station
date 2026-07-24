import SwiftUI

/// The only screen. Staff plug the phone in and press Start; the station films
/// on the chosen interval until somebody presses Stop.
struct StationView: View {
    @EnvironmentObject var camera: CameraController
    @EnvironmentObject var uploader: UploadQueue
    @EnvironmentObject var station: StationConfig
    @EnvironmentObject var kiosk: KioskMode
    @EnvironmentObject var scheduler: CaptureScheduler
    @EnvironmentObject var health: DeviceHealth

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
        // Dimming protects the panel over months of always-on use; any touch
        // brings it straight back.
        .opacity(kiosk.isDimmed ? 0.35 : 1)
        .animation(.easeInOut(duration: 0.6), value: kiosk.isDimmed)
        .contentShape(Rectangle())
        .onTapGesture { kiosk.noteActivity() }
        .task {
            await camera.configure()
            await station.refreshAuthAndPing()
        }
    }

    // MARK: - Station

    private var stationView: some View {
        VStack(spacing: 0) {
            Text("CONTENT STATION")
                .font(.headline.monospaced())
                .foregroundStyle(.white.opacity(0.8))
                .padding(.top, 12)

            // Device trouble in words staff can act on. Blockers are why the
            // station is not filming; warnings are things heading that way.
            if let problem = health.current.captureBlocked {
                healthBanner(problem, color: .red)
            } else if let warning = health.current.warning {
                healthBanner(warning, color: .orange)
            }

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
            }
            .padding(.horizontal, 16)
            .padding(.top, 8)

            statusRow
                .padding(.top, 14)

            if !scheduler.isRunning {
                intervalPicker
                    .padding(.top, 14)
            }

            startStopButton
                .padding(.vertical, 18)

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

    // MARK: - Status

    /// Schedule state first, camera trouble underneath it. A camera hiccup must
    /// not hide whether the station is still running and when the next clip is
    /// due — that is the only thing anyone on site can check at a glance.
    @ViewBuilder
    private var statusRow: some View {
        VStack(spacing: 6) {
            if case .recording = camera.state {
                Label("RECORDING", systemImage: "record.circle")
                    .foregroundStyle(.red)
                    .font(.subheadline.monospaced().bold())
            } else if scheduler.isRunning {
                Label("RUNNING", systemImage: "circle.fill")
                    .foregroundStyle(.green)
                    .font(.subheadline.monospaced().bold())
                Text("Next clip in \(formatted(scheduler.secondsUntilNext))")
                    .font(.callout.monospaced())
                    .foregroundStyle(.white.opacity(0.65))
            } else {
                Label("STOPPED", systemImage: "pause.circle")
                    .foregroundStyle(.white.opacity(0.6))
                    .font(.subheadline.monospaced().bold())
            }

            if case .error(let message) = camera.state {
                Label(message, systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.red)
                    .font(.caption.monospaced())
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 20)
            }
        }
    }

    private func healthBanner(_ message: String, color: Color) -> some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white)
            .padding(.vertical, 8)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity)
            .background(color.opacity(0.85))
            .padding(.horizontal, 16)
            .padding(.top, 8)
    }

    private func formatted(_ seconds: Int) -> String {
        seconds >= 60 ? "\(seconds / 60)m \(seconds % 60)s" : "\(seconds)s"
    }

    private var intervalPicker: some View {
        VStack(spacing: 8) {
            Text("Film a clip every")
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.6))
            HStack(spacing: 8) {
                ForEach(CaptureScheduler.intervalOptions, id: \.self) { minutes in
                    Button {
                        kiosk.noteActivity()
                        scheduler.setInterval(minutes)
                    } label: {
                        Text(minutes >= 60 ? "\(minutes / 60)h" : "\(minutes)m")
                            .font(.subheadline.weight(.semibold))
                            .frame(width: 52, height: 36)
                            .background(
                                scheduler.intervalMinutes == minutes ? Color.white : Color.white.opacity(0.12),
                                in: RoundedRectangle(cornerRadius: 10)
                            )
                            .foregroundStyle(scheduler.intervalMinutes == minutes ? .black : .white)
                    }
                }
            }
        }
    }

    private var startStopButton: some View {
        Button {
            kiosk.noteActivity()
            scheduler.isRunning ? scheduler.stop() : scheduler.start()
        } label: {
            Text(scheduler.isRunning ? "STOP" : "START")
                .font(.title2.weight(.bold))
                .frame(maxWidth: .infinity)
                .frame(height: 64)
                .background(scheduler.isRunning ? Color.red : Color.green, in: Capsule())
                .foregroundStyle(.white)
                .padding(.horizontal, 40)
        }
        .disabled(station.isAuthenticated == false)
        .opacity(station.isAuthenticated == false ? 0.4 : 1)
    }

    private var footer: some View {
        HStack(spacing: 16) {
            Label(connectionLabel, systemImage: connectionIcon)
                .foregroundStyle(connectionColor)
            Text("Clips: \(scheduler.capturesThisSession)")
                .foregroundStyle(.white.opacity(0.8))
            Spacer()
            if uploader.pendingCount > 0 {
                Text("Uploading \(uploader.pendingCount)")
                    .foregroundStyle(.orange)
            } else {
                Text("All uploaded")
                    .foregroundStyle(.white.opacity(0.5))
            }
        }
        .font(.caption.monospaced())
        .padding(.horizontal, 24)
    }

    private var connectionLabel: String {
        switch station.isAuthenticated {
        case .some(true): return "Connected"
        case .some(false): return "Not connected"
        case .none: return "Connecting…"
        }
    }

    private var connectionIcon: String {
        station.isAuthenticated == true ? "checkmark.icloud" : "exclamationmark.icloud"
    }

    private var connectionColor: Color {
        switch station.isAuthenticated {
        case .some(true): return .green
        case .some(false): return .red
        case .none: return .yellow
        }
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
            Text("Content Station records short clips of moments at your business. Please allow camera and microphone access, then reopen the app.")
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
        .environmentObject(KioskMode())
        .environmentObject(CaptureScheduler())
        .environmentObject(DeviceHealth())
        .preferredColorScheme(.dark)
}
