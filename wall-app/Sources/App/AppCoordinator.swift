import AVFoundation
import Combine
import Foundation
import UIKit

/// Wires the state machine, capture pipeline, network loops, and pairing
/// together. Everything here runs on the main actor; the capture pipeline
/// calls back onto it.
@MainActor
final class AppCoordinator: ObservableObject {
    static let shared = AppCoordinator()

    let stateMachine: StateMachine
    let thermal = ThermalMonitor()
    let connectivity = Connectivity()
    let api: ApiClient
    let identity: DeviceIdentity
    let capture = CaptureManager()
    let pipeline: CapturePipeline
    let poller: ConfigPoller
    let heartbeat: HeartbeatService
    let uploads: UploadQueue
    let pairing: PairingFlow

    private var cancellables = Set<AnyCancellable>()
    private var maintenanceTimer: Timer?
    private var lastCleanupAt = Date.distantPast
    private var lastReferenceFrameRevision: String?
    private var started = false

    private init() {
        identity = DeviceIdentity.load()
        api = ApiClient()
        let paired = !(Keychain.string(for: .deviceJWT) ?? "").isEmpty
        stateMachine = StateMachine(isPaired: paired, shortCode: identity.shortCode)
        pipeline = CapturePipeline(segmentsDirectory: AppDirectories.segments, supportDirectory: AppDirectories.support)
        poller = ConfigPoller(api: api)
        heartbeat = HeartbeatService(api: api)
        uploads = UploadQueue(api: api, segmentsDirectory: AppDirectories.segments, supportDirectory: AppDirectories.support)
        pairing = PairingFlow(api: api, identity: identity, stateMachine: stateMachine)

        if let cached = ConfigStore.load() {
            lastReferenceFrameRevision = cached.referenceFrameRevision
            stateMachine.config = cached
        }
        stateMachine.previewOverride = LaunchArguments.previewState
        if paired && !api.isConfigured {
            Log.app.error("paired but api not configured")
        }
        uploads.setPairing(deviceID: paired ? Keychain.string(for: .deviceId) : nil, token: paired ? Keychain.string(for: .deviceJWT) : nil)
        pipeline.segmentWriter.setDeviceID(paired ? Keychain.string(for: .deviceId) : nil)
        wire()
    }

    // MARK: Lifecycle

    func start() {
        guard !started else { return }
        started = true
        Log.app.info("start paired=\(self.stateMachine.isPaired, privacy: .public) preview=\(LaunchArguments.previewState?.rawValue ?? "none", privacy: .public)")
        capture.apply(intent: stateMachine.captureIntent)
        pipeline.setIntent(stateMachine.captureIntent)
        if stateMachine.isPaired {
            startNormalLoop()
        }
        uploads.adoptOrphans()
        uploads.cleanup()
        maintenanceTimer = Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.runMaintenance() }
        }
    }

    func didBecomeActive() {
        guard started else { return }
        capture.apply(intent: stateMachine.captureIntent)
        uploads.kick()
    }

    /// Retries uploads, deletes old footage, and clears the storage fault
    /// once space is back.
    func runMaintenance() {
        uploads.kick()
        if Date().timeIntervalSince(lastCleanupAt) > 3600 {
            lastCleanupAt = Date()
            uploads.cleanup()
        }
        let free = UploadQueue.freeBytes()
        if stateMachine.fault == .storageFull, free > UploadQueue.minimumFreeBytes + 200_000_000 {
            stateMachine.fault = nil
        } else if stateMachine.fault == nil, free < UploadQueue.minimumFreeBytes, stateMachine.isPaired {
            stateMachine.fault = .storageFull
        }
    }

    // MARK: Wiring

    private func wire() {
        thermal.$state
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in
                guard let self else { return }
                self.stateMachine.thermal = state
                self.capture.setReducedResolution(state == .serious)
                if state == .critical { self.pipeline.segmentWriter.stop() }
            }
            .store(in: &cancellables)

        connectivity.$level
            .receive(on: DispatchQueue.main)
            .sink { [weak self] level in self?.stateMachine.connectivity = level }
            .store(in: &cancellables)

        stateMachine.$captureIntent
            .removeDuplicates()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] intent in
                guard let self else { return }
                self.capture.apply(intent: intent)
                self.pipeline.setIntent(intent)
                self.capture.setExposureLocked(intent == .recording || intent == .idle)
            }
            .store(in: &cancellables)

        stateMachine.$displayState
            .removeDuplicates()
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] state in self?.report(state) }
            .store(in: &cancellables)

        capture.onFrame = { [pipeline] pixelBuffer, time, date in
            pipeline.handle(pixelBuffer, presentationTime: time, date: date)
        }
        capture.onQRCode = { [weak self] raw in
            Task { @MainActor in self?.pairing.handleQRCode(raw) }
        }
        capture.onUnavailable = { [weak self] in
            Task { @MainActor in
                guard let self, self.stateMachine.previewOverride == nil else { return }
                self.stateMachine.fault = .cameraUnavailable
            }
        }

        pipeline.onDriftChanged = { [weak self] drifted in
            Task { @MainActor in self?.stateMachine.driftDetected = drifted }
        }
        pipeline.segmentWriter.onSegmentFinished = { [weak self] file in
            self?.uploads.enqueue(file)
        }
        pipeline.segmentWriter.onStorageFull = { [weak self] in
            Task { @MainActor in self?.stateMachine.fault = .storageFull }
        }
        pipeline.thumbnails.send = { [weak self] data in
            Task { @MainActor in
                guard let self, self.stateMachine.isPaired, let token = Keychain.string(for: .deviceJWT) else { return }
                Task.detached { [api = self.api] in
                    do { try await api.thumb(jpeg: data, token: token) } catch { Log.network.debug("thumb failed") }
                }
            }
        }
        pipeline.previews.send = { [weak self] data in
            Task { @MainActor in
                guard let self, self.stateMachine.isPaired, let token = Keychain.string(for: .deviceJWT) else { return }
                Task.detached { [api = self.api] in
                    do { try await api.preview(jpeg: data, token: token) } catch { Log.network.debug("preview failed") }
                }
            }
        }

        poller.onConfig = { [weak self] config in
            Task { @MainActor in self?.apply(config: config) }
        }
        poller.onSuccess = { [weak self] in
            Task { @MainActor in self?.connectivity.recordSuccess() }
        }
        poller.onFailure = { [weak self] error in
            Task { @MainActor in
                if error.isConnectivityFailure { self?.connectivity.recordFailure() }
            }
        }
        poller.onUnauthorized = { [weak self] in
            Task { @MainActor in self?.unpair(reason: "config 401") }
        }

        heartbeat.gather = { [weak self] in
            await self?.buildHeartbeat() ?? HeartbeatRequest(
                battery: 100, thermal: "nominal", wifi: "none", storageFreeMb: 0,
                state: "idle", code: nil, appVersion: DeviceIdentity.appVersion, recordingSecondsToday: 0
            )
        }
        heartbeat.onConfig = { [weak self] config in
            Task { @MainActor in self?.apply(config: config) }
        }
        heartbeat.onSuccess = { [weak self] in
            Task { @MainActor in
                self?.connectivity.recordSuccess()
                self?.uploads.kick()
            }
        }
        heartbeat.onFailure = { [weak self] error in
            Task { @MainActor in
                if error.isConnectivityFailure { self?.connectivity.recordFailure() }
            }
        }
        heartbeat.onUnauthorized = { [weak self] in
            Task { @MainActor in self?.unpair(reason: "heartbeat 401") }
        }

        uploads.onUnauthorized = { [weak self] in
            Task { @MainActor in self?.unpair(reason: "upload 401") }
        }
        uploads.onConnectivity = { [weak self] ok in
            Task { @MainActor in
                if ok { self?.connectivity.recordSuccess() }
            }
        }

        pairing.onPaired = { [weak self] response in
            guard let self else { return }
            self.uploads.setPairing(deviceID: response.deviceId, token: response.deviceJwt)
            self.pipeline.segmentWriter.setDeviceID(response.deviceId)
            self.stateMachine.fault = nil
            self.stateMachine.isPaired = true
            if let config = response.config {
                self.apply(config: config)
            }
            self.startNormalLoop()
        }
        pairing.onFault = { [weak self] code in
            self?.stateMachine.fault = code
        }
        pairing.onFaultCleared = { [weak self] code in
            guard let self, self.stateMachine.fault == code else { return }
            self.stateMachine.fault = nil
        }
    }

    // MARK: Normal loop

    private func startNormalLoop() {
        poller.start(since: stateMachine.config?.updatedAt)
        heartbeat.start()
        uploads.kick()
    }

    private func stopNormalLoop() {
        poller.stop()
        heartbeat.stop()
    }

    private func apply(config: DeviceConfig) {
        if config.isUnpaired {
            unpair(reason: "config unpaired")
            return
        }
        ConfigStore.save(config)
        let previousReference = lastReferenceFrameRevision
        stateMachine.config = config
        if config.hasNewReference(comparedTo: previousReference) {
            // A new reference frame: store the current picture as the drift
            // baseline and clear any drift.
            lastReferenceFrameRevision = config.referenceFrameRevision
            pipeline.captureReferenceFrame()
            pipeline.clearDrift()
            stateMachine.driftDetected = false
        } else if config.referenceFrameRevision == nil {
            lastReferenceFrameRevision = nil
        }
    }

    private func report(_ state: WallState) {
        guard stateMachine.isPaired, stateMachine.previewOverride == nil else { return }
        let reported = state.reported(faultCode: stateMachine.fault?.rawValue)
        Task { [api] in
            do {
                try await api.status(reported.status, code: reported.code)
            } catch let error as ApiError {
                if case .unauthorized = error {
                    await MainActor.run { self.unpair(reason: "status 401") }
                } else {
                    Log.network.error("status report failed: \(error.description, privacy: .public)")
                }
            } catch {
                Log.network.error("status report failed")
            }
        }
    }

    private func unpair(reason: String) {
        guard stateMachine.isPaired else { return }
        Log.app.warning("unpairing: \(reason, privacy: .public)")
        stopNormalLoop()
        uploads.setPairing(deviceID: nil, token: nil)
        pipeline.segmentWriter.setDeviceID(nil)
        api.cancelOutstandingRequests()
        Keychain.delete(.deviceJWT)
        Keychain.delete(.deviceId)
        ConfigStore.clear()
        pipeline.driftDetector.clearReference()
        lastReferenceFrameRevision = nil
        stateMachine.driftDetected = false
        stateMachine.fault = nil
        stateMachine.config = nil
        stateMachine.isPaired = false
    }

    // MARK: Heartbeat

    private func buildHeartbeat() async -> HeartbeatRequest {
        let level = UIDevice.current.batteryLevel
        let battery = level < 0 ? 100 : Int((level * 100).rounded())
        let reported = stateMachine.displayState.reported(faultCode: stateMachine.fault?.rawValue)
        let seconds: Int = await withCheckedContinuation { continuation in
            pipeline.segmentWriter.recordingSecondsToday { continuation.resume(returning: $0) }
        }
        return HeartbeatRequest(
            battery: battery,
            thermal: ThermalMonitor.word(for: thermal.state),
            wifi: connectivity.wifiWord,
            storageFreeMb: UploadQueue.freeMegabytes(),
            state: reported.status,
            code: reported.code,
            appVersion: DeviceIdentity.appVersion,
            recordingSecondsToday: seconds
        )
    }
}
