import Combine
import Foundation

/// What the capture pipeline should be doing for the current state.
enum CaptureIntent: Equatable {
    /// Session stopped (thermal critical, fault).
    case off
    /// Session running with QR detection, zoom 2.0, nothing written.
    case waiting
    /// Session running, preview frames streamed, nothing written.
    case framing
    /// Session running, motion gated recording.
    case recording
    /// Session running, nothing written (outside hours, paused).
    case idle
}

/// Owns the priority rules from the contract and derives one display state
/// from every input. Inputs are set by the coordinator, the poller, the
/// pairing flow, the thermal monitor, and the drift detector.
@MainActor
final class StateMachine: ObservableObject {
    enum PairingPhase: Equatable {
        case none
        case reading
        case connecting(ssid: String)
    }

    enum ConnectivityLevel: Equatable {
        case online
        case noInternet
        case noInternetLong
    }

    // Inputs.
    @Published var isPaired: Bool { didSet { recompute() } }
    @Published var pairingPhase: PairingPhase = .none { didSet { recompute() } }
    @Published var config: DeviceConfig? { didSet { configChanged(from: oldValue); recompute() } }
    @Published var thermal: ProcessInfo.ThermalState = .nominal { didSet { recompute() } }
    @Published var driftDetected = false { didSet { recompute() } }
    @Published var connectivity: ConnectivityLevel = .online { didSet { recompute() } }
    @Published var fault: FaultCode? { didSet { recompute() } }
    @Published var previewOverride: WallState? { didSet { recompute() } }
    @Published var shortCode: String = "" { didSet { recompute() } }

    // Outputs.
    @Published private(set) var displayState: WallState = .waiting
    @Published private(set) var copy: StateCopy = StateCopy(glyph: nil, line1: "", line2: "", code: "")
    @Published private(set) var captureIntent: CaptureIntent = .off
    @Published private(set) var isInsideHours = true
    @Published private(set) var isFramingActive = false

    /// The reference frame url seen when the current framing window opened.
    /// Framing exits as soon as a different one arrives.
    private var framingReferenceAtStart: String??
    private var timer: Timer?
    var now: () -> Date = { Date() }

    init(isPaired: Bool, shortCode: String) {
        self.isPaired = isPaired
        self.shortCode = shortCode
        recompute()
        timer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.recompute() }
        }
    }

    deinit {
        timer?.invalidate()
    }

    /// Fault codes that stop the camera outright.
    private var faultStopsCapture: Bool {
        switch fault {
        case .storageFull, .cameraUnavailable, .unknown: return true
        case .wifiJoin, .pairClaim: return false
        case .none: return false
        }
    }

    private func configChanged(from old: DeviceConfig?) {
        guard let config else {
            framingReferenceAtStart = nil
            return
        }
        let current = now()
        if config.isFraming(at: current) {
            if framingReferenceAtStart == nil || old?.framingUntil != config.framingUntil {
                framingReferenceAtStart = .some(config.referenceFrameUrl)
            }
        } else {
            framingReferenceAtStart = nil
        }
    }

    private func framingActive(at current: Date) -> Bool {
        guard let config, config.isFraming(at: current) else { return false }
        guard let start = framingReferenceAtStart else { return true }
        // Exit when a new reference frame arrives.
        if start != config.referenceFrameUrl, config.referenceFrameUrl != nil {
            return false
        }
        return true
    }

    func recompute() {
        let current = now()
        let evaluator = HoursEvaluator(hours: config?.hours, timeZoneIdentifier: config?.timezone)
        let hours = evaluator.evaluate(at: current)
        let framing = framingActive(at: current)
        let paused = config?.isPaused(at: current) ?? false

        let state = derive(now: current, insideHours: hours.isOpen, framing: framing, paused: paused)
        let intent = deriveIntent(insideHours: hours.isOpen, framing: framing, paused: paused)

        var context = CopyContext()
        context.shortCode = shortCode
        if case .connecting(let ssid) = pairingPhase { context.ssid = ssid }
        if let until = config?.pausedUntilDate, paused {
            context.pausedUntil = TimeFormat.clock(until, timeZone: config?.timeZone ?? .current)
        }
        context.faultCode = (fault ?? .unknown).rawValue
        if previewOverride != nil {
            // Sample values so preview screens look like the design.
            if context.ssid.isEmpty { context.ssid = "Fade Society" }
            if context.pausedUntil.isEmpty { context.pausedUntil = "3:00 PM" }
            if context.shortCode.isEmpty { context.shortCode = "4KP7" }
        }
        let newCopy = StateCopy.copy(for: state, context: context)

        if isInsideHours != hours.isOpen { isInsideHours = hours.isOpen }
        if isFramingActive != framing { isFramingActive = framing }
        if captureIntent != intent { captureIntent = intent }
        if copy != newCopy { copy = newCopy }
        if displayState != state {
            Log.state.info("state \(self.displayState.rawValue, privacy: .public) -> \(state.rawValue, privacy: .public)")
            displayState = state
        }
    }

    private func derive(now: Date, insideHours: Bool, framing: Bool, paused: Bool) -> WallState {
        if let previewOverride { return previewOverride }
        if thermal == .critical { return .hot }
        if fault != nil { return .fault }
        if !isPaired {
            switch pairingPhase {
            case .connecting: return .connecting
            case .reading: return .reading
            case .none: return .waiting
            }
        }
        if framing { return .framing }
        if paused { return .paused }
        if driftDetected { return .reframe }
        switch connectivity {
        case .noInternet: return .nointernet
        case .noInternetLong: return .nointernetLong
        case .online: break
        }
        return insideHours ? .recording : .idle
    }

    private func deriveIntent(insideHours: Bool, framing: Bool, paused: Bool) -> CaptureIntent {
        if thermal == .critical { return .off }
        if fault != nil, faultStopsCapture { return .off }
        if !isPaired { return .waiting }
        if framing { return .framing }
        if paused { return .idle }
        return insideHours ? .recording : .idle
    }
}
