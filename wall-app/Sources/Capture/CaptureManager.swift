import AVFoundation
import CoreMedia
import Foundation

/// Owns the AVCaptureSession: rear wide camera, 1920x1080 at 30 fps, frames
/// through AVCaptureVideoDataOutput, QR codes through AVCaptureMetadataOutput.
/// Degrades to "unavailable" in the simulator or when no camera exists.
final class CaptureManager: NSObject {
    let session = AVCaptureSession()

    /// Called on the frame queue for every frame while the session runs.
    var onFrame: ((CVPixelBuffer, CMTime, Date) -> Void)?
    /// Called on the frame queue with the decoded QR string.
    var onQRCode: ((String) -> Void)?
    /// Called once when the camera cannot be used on a real device.
    var onUnavailable: (() -> Void)?

    private(set) var isAvailable = false

    private let sessionQueue = DispatchQueue(label: "ai.contentstation.wall.capture.session")
    private let frameQueue = DispatchQueue(label: "ai.contentstation.wall.capture.frames", qos: .userInitiated)
    private let videoOutput = AVCaptureVideoDataOutput()
    private let metadataOutput = AVCaptureMetadataOutput()
    private var device: AVCaptureDevice?
    private var configured = false
    private var intent: CaptureIntent = .off
    private var reducedResolution = false
    private var exposureLocked = false

    /// The session for the framing preview, nil when there is no camera.
    var previewSession: AVCaptureSession? {
        isAvailable ? session : nil
    }

    // MARK: Control

    func apply(intent: CaptureIntent) {
        sessionQueue.async {
            self.intent = intent
            self.configureIfNeeded()
            guard self.isAvailable else { return }
            if intent == .off {
                if self.session.isRunning { self.session.stopRunning() }
                return
            }
            self.applyZoom(intent == .waiting ? 2.0 : 1.0)
            self.metadataOutput.connection(with: .metadataObject)?.isEnabled = (intent == .waiting)
            if !self.session.isRunning { self.session.startRunning() }
        }
    }

    /// 720p while thermal state is serious, 1080p otherwise.
    func setReducedResolution(_ reduced: Bool) {
        sessionQueue.async {
            guard self.reducedResolution != reduced else { return }
            self.reducedResolution = reduced
            guard self.isAvailable else { return }
            let preset: AVCaptureSession.Preset = reduced ? .hd1280x720 : .hd1920x1080
            guard self.session.canSetSessionPreset(preset) else { return }
            self.session.beginConfiguration()
            self.session.sessionPreset = preset
            self.session.commitConfiguration()
            self.applyFrameRate()
            Log.capture.info("capture preset \(reduced ? "720p" : "1080p", privacy: .public)")
        }
    }

    /// Lock exposure and white balance after framing so the picture does not
    /// flicker. Unlock while waiting and framing.
    func setExposureLocked(_ locked: Bool) {
        sessionQueue.async {
            guard self.exposureLocked != locked else { return }
            self.exposureLocked = locked
            guard let device = self.device else { return }
            do {
                try device.lockForConfiguration()
                if locked {
                    if device.isExposureModeSupported(.locked) { device.exposureMode = .locked }
                    if device.isWhiteBalanceModeSupported(.locked) { device.whiteBalanceMode = .locked }
                } else {
                    if device.isExposureModeSupported(.continuousAutoExposure) { device.exposureMode = .continuousAutoExposure }
                    if device.isWhiteBalanceModeSupported(.continuousAutoWhiteBalance) { device.whiteBalanceMode = .continuousAutoWhiteBalance }
                }
                device.unlockForConfiguration()
            } catch {
                Log.capture.error("exposure lock failed: \(error.localizedDescription, privacy: .public)")
            }
        }
    }

    // MARK: Setup

    private func configureIfNeeded() {
        guard !configured else { return }
        configured = true

        #if targetEnvironment(simulator)
        Log.capture.info("simulator has no camera, capture disabled")
        isAvailable = false
        return
        #else
        guard let camera = AVCaptureDevice.default(.builtInWideAngleCamera, for: .video, position: .back) else {
            Log.capture.error("no rear wide camera")
            markUnavailable()
            return
        }
        switch AVCaptureDevice.authorizationStatus(for: .video) {
        case .authorized:
            break
        case .notDetermined:
            let semaphore = DispatchSemaphore(value: 0)
            var granted = false
            AVCaptureDevice.requestAccess(for: .video) { result in
                granted = result
                semaphore.signal()
            }
            semaphore.wait()
            guard granted else {
                markUnavailable()
                return
            }
        default:
            markUnavailable()
            return
        }

        session.beginConfiguration()
        let preset: AVCaptureSession.Preset = reducedResolution ? .hd1280x720 : .hd1920x1080
        if session.canSetSessionPreset(preset) {
            session.sessionPreset = preset
        }
        do {
            let input = try AVCaptureDeviceInput(device: camera)
            guard session.canAddInput(input) else {
                session.commitConfiguration()
                markUnavailable()
                return
            }
            session.addInput(input)
        } catch {
            session.commitConfiguration()
            Log.capture.error("camera input failed: \(error.localizedDescription, privacy: .public)")
            markUnavailable()
            return
        }

        videoOutput.videoSettings = [
            kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_420YpCbCr8BiPlanarVideoRange,
        ]
        videoOutput.alwaysDiscardsLateVideoFrames = true
        videoOutput.setSampleBufferDelegate(self, queue: frameQueue)
        if session.canAddOutput(videoOutput) {
            session.addOutput(videoOutput)
        }
        if let connection = videoOutput.connection(with: .video), connection.isVideoRotationAngleSupported(90) {
            connection.videoRotationAngle = 90
        }

        metadataOutput.setMetadataObjectsDelegate(self, queue: frameQueue)
        if session.canAddOutput(metadataOutput) {
            session.addOutput(metadataOutput)
            if metadataOutput.availableMetadataObjectTypes.contains(.qr) {
                metadataOutput.metadataObjectTypes = [.qr]
            }
        }
        session.commitConfiguration()

        device = camera
        isAvailable = true
        applyFrameRate()
        Log.capture.info("capture configured")
        #endif
    }

    private func markUnavailable() {
        isAvailable = false
        onUnavailable?()
    }

    private func applyFrameRate() {
        guard let device else { return }
        do {
            try device.lockForConfiguration()
            let duration = CMTime(value: 1, timescale: CMTimeScale(Product.captureFps))
            let ranges = device.activeFormat.videoSupportedFrameRateRanges
            if ranges.contains(where: { $0.minFrameRate <= Double(Product.captureFps) && Double(Product.captureFps) <= $0.maxFrameRate }) {
                device.activeVideoMinFrameDuration = duration
                device.activeVideoMaxFrameDuration = duration
            }
            device.unlockForConfiguration()
        } catch {
            Log.capture.error("frame rate lock failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    private func applyZoom(_ factor: CGFloat) {
        guard let device else { return }
        do {
            try device.lockForConfiguration()
            let clamped = min(max(1, factor), device.activeFormat.videoMaxZoomFactor)
            if device.videoZoomFactor != clamped {
                device.videoZoomFactor = clamped
            }
            device.unlockForConfiguration()
        } catch {
            Log.capture.error("zoom failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}

extension CaptureManager: AVCaptureVideoDataOutputSampleBufferDelegate {
    func captureOutput(_ output: AVCaptureOutput, didOutput sampleBuffer: CMSampleBuffer, from connection: AVCaptureConnection) {
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else { return }
        onFrame?(pixelBuffer, CMSampleBufferGetPresentationTimeStamp(sampleBuffer), Date())
    }
}

extension CaptureManager: AVCaptureMetadataOutputObjectsDelegate {
    func metadataOutput(_ output: AVCaptureMetadataOutput, didOutput metadataObjects: [AVMetadataObject], from connection: AVCaptureConnection) {
        for object in metadataObjects {
            guard let code = object as? AVMetadataMachineReadableCodeObject, code.type == .qr,
                  let value = code.stringValue, !value.isEmpty else { continue }
            onQRCode?(value)
            return
        }
    }
}
