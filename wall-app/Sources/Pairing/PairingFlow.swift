import Foundation

/// Reading for at least 1.5 s, then connecting: join Wi-Fi, tell the server
/// the QR was read, claim with the device serial, store the credentials.
/// On failure shows fault W-01 or P-01 and returns to waiting after 20 s.
@MainActor
final class PairingFlow {
    var readingHoldSeconds: TimeInterval = 1.5
    var faultHoldSeconds: TimeInterval = 20

    var onPaired: ((PairClaimResponse) -> Void)?
    var onFault: ((FaultCode) -> Void)?
    var onFaultCleared: ((FaultCode) -> Void)?

    private(set) var isBusy = false
    private var lastFailedToken: String?

    private let api: ApiClient
    private let identity: DeviceIdentity
    private let stateMachine: StateMachine

    init(api: ApiClient, identity: DeviceIdentity, stateMachine: StateMachine) {
        self.api = api
        self.identity = identity
        self.stateMachine = stateMachine
    }

    func handleQRCode(_ raw: String) {
        guard !isBusy, !stateMachine.isPaired else { return }
        guard let payload = QRPayload.decode(raw) else { return }
        if payload.pairToken == lastFailedToken { return }
        isBusy = true
        Task { await run(payload) }
    }

    private func run(_ payload: QRPayload) async {
        Log.pairing.info("qr read, token \(Log.redacted(payload.pairToken), privacy: .public)")
        stateMachine.pairingPhase = .reading
        try? await Task.sleep(nanoseconds: UInt64(readingHoldSeconds * 1_000_000_000))

        stateMachine.pairingPhase = .connecting(ssid: payload.ssid)
        do {
            try await WifiJoiner.join(ssid: payload.ssid, password: payload.password)
        } catch {
            await fail(.wifiJoin, token: payload.pairToken)
            return
        }

        let token = payload.pairToken
        Task.detached { [api] in
            await api.pairReading(token: token)
        }

        let request = PairClaimRequest(
            pairToken: token,
            serial: identity.serial,
            model: DeviceIdentity.model,
            appVersion: DeviceIdentity.appVersion
        )
        do {
            let response = try await api.pairClaim(request)
            Keychain.set(response.deviceJwt, for: .deviceJWT)
            Keychain.set(response.deviceId, for: .deviceId)
            lastFailedToken = nil
            stateMachine.pairingPhase = .none
            isBusy = false
            Log.pairing.info("paired as device \(response.deviceId, privacy: .public)")
            onPaired?(response)
        } catch {
            Log.pairing.error("claim failed: \((error as? ApiError)?.description ?? error.localizedDescription, privacy: .public)")
            await fail(.pairClaim, token: token)
        }
    }

    private func fail(_ code: FaultCode, token: String) async {
        lastFailedToken = token
        stateMachine.pairingPhase = .none
        onFault?(code)
        try? await Task.sleep(nanoseconds: UInt64(faultHoldSeconds * 1_000_000_000))
        onFaultCleared?(code)
        isBusy = false
    }
}
