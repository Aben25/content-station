import AVFoundation
import Combine
import Foundation
import UIKit

enum StationState: Equatable {
    case unauthorized
    case ready
    case countdown(Int)
    case recording
    case saving
    case error(String)
}

/// Owns the AVCaptureSession lifecycle and movie recording for the mounted
/// station. Phase 1 scope: rear camera, countdown, 15s clip, local save.
final class CameraController: NSObject, ObservableObject {
    let session = AVCaptureSession()

    @Published private(set) var state: StationState = .ready
    @Published private(set) var recordingSeconds: TimeInterval = 0
    @Published private(set) var lastSavedURL: URL?

    var recordingDuration: TimeInterval = 15

    private let movieOutput = AVCaptureMovieFileOutput()
    private let sessionQueue = DispatchQueue(label: "station.session")
    private var countdownTask: Task<Void, Never>?
    private var timerTask: Task<Void, Never>?

    override init() {
        super.init()
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(handleInterruption),
            name: UIApplication.willResignActiveNotification,
            object: nil
        )
    }

    // MARK: - Setup

    func configure() async {
        let videoOK = await Self.requestAccess(for: .video)
        let audioOK = await Self.requestAccess(for: .audio)
        guard videoOK, audioOK else {
            await MainActor.run { state = .unauthorized }
            return
        }
        await withCheckedContinuation { (cont: CheckedContinuation<Void, Never>) in
            sessionQueue.async {
                self.configureSession()
                cont.resume()
            }
        }
    }

    private static func requestAccess(for mediaType: AVMediaType) async -> Bool {
        switch AVCaptureDevice.authorizationStatus(for: mediaType) {
        case .authorized: return true
        case .notDetermined: return await AVCaptureDevice.requestAccess(for: mediaType)
        default: return false
        }
    }

    private func configureSession() {
        session.beginConfiguration()
        defer { session.commitConfiguration() }

        session.sessionPreset = .high

        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back),
              let videoInput = try? AVCaptureDeviceInput(device: camera),
              session.canAddInput(videoInput) else {
            DispatchQueue.main.async { self.state = .error("Rear camera unavailable") }
            return
        }
        session.addInput(videoInput)

        if let mic = AVCaptureDevice.default(for: .audio),
           let audioInput = try? AVCaptureDeviceInput(device: mic),
           session.canAddInput(audioInput) {
            session.addInput(audioInput)
        }

        guard session.canAddOutput(movieOutput) else {
            DispatchQueue.main.async { self.state = .error("Cannot record video") }
            return
        }
        session.addOutput(movieOutput)

        if let connection = movieOutput.connection(with: .video) {
            if #available(iOS 17.0, *) {
                if connection.isVideoRotationAngleSupported(90) {
                    connection.videoRotationAngle = 90 // portrait for 9:16 capture
                }
            } else if connection.isVideoOrientationSupported {
                connection.videoOrientation = .portrait
            }
            if connection.isVideoStabilizationSupported {
                connection.preferredVideoStabilizationMode = .auto
            }
        }

        sessionQueue.async { self.session.startRunning() }
    }

    // MARK: - Capture flow

    func tapCapture() {
        guard state == .ready, session.isRunning, !movieOutput.isRecording else { return }
        countdownTask?.cancel()
        countdownTask = Task { @MainActor in
            for n in stride(from: 3, through: 1, by: -1) {
                state = .countdown(n)
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if Task.isCancelled { return }
            }
            startRecording()
        }
    }

    func stopRecording() {
        guard movieOutput.isRecording else { return }
        movieOutput.stopRecording()
    }

    private func startRecording() {
        let url = FileManager.default.temporaryDirectory
            .appendingPathComponent(UUID().uuidString)
            .appendingPathExtension("mp4")
        movieOutput.startRecording(to: url, recordingDelegate: self)
        state = .recording
        recordingSeconds = 0

        timerTask?.cancel()
        timerTask = Task { @MainActor in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 250_000_000)
                guard state == .recording else { return }
                recordingSeconds += 0.25
                if recordingSeconds >= recordingDuration {
                    stopRecording()
                    return
                }
            }
        }
    }

    /// Rule from the spec: recording must stop if the app is interrupted
    /// or moved to the background.
    @objc private func handleInterruption() {
        countdownTask?.cancel()
        if movieOutput.isRecording { movieOutput.stopRecording() }
        if case .countdown = state { state = .ready }
    }

    // MARK: - Local save

    private func saveToLibrary(_ tempURL: URL) throws -> URL {
        let dir = try CaptureStore.recordingsDirectory()
        let dest = dir.appendingPathComponent(tempURL.lastPathComponent)
        if FileManager.default.fileExists(atPath: dest.path) {
            try FileManager.default.removeItem(at: dest)
        }
        try FileManager.default.moveItem(at: tempURL, to: dest)
        return dest
    }
}

// MARK: - AVCaptureFileOutputRecordingDelegate

extension CameraController: AVCaptureFileOutputRecordingDelegate {
    func fileOutput(_ output: AVCaptureFileOutput,
                    didFinishRecordingTo outputFileURL: URL,
                    from connections: [AVCaptureConnection],
                    error: Error?) {
        timerTask?.cancel()
        Task { @MainActor in
            defer { recordingSeconds = 0 }

            if let error = error as NSError?,
               error.domain == AVFoundationErrorDomain,
               error.code != AVError.maximumFileSizeReached.rawValue,
               error.code != AVError.diskFull.rawValue {
                // Keep partial file on length limits; fail on real errors.
                if !FileManager.default.fileExists(atPath: outputFileURL.path) {
                    state = .error("Recording failed: \(error.localizedDescription)")
                    try? FileManager.default.removeItem(at: outputFileURL)
                    return
                }
            }

            state = .saving
            do {
                let saved = try saveToLibrary(outputFileURL)
                lastSavedURL = saved
                state = .ready
                NotificationCenter.default.post(
                    name: .captureSaved,
                    object: nil,
                    userInfo: ["url": saved]
                )
            } catch {
                state = .error("Save failed: \(error.localizedDescription)")
            }
        }
    }
}

extension Notification.Name {
    static let captureSaved = Notification.Name("station.captureSaved")
}
