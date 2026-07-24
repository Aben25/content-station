import Foundation

/// The station's Firebase identity and pairing state.
///
/// On first launch the app signs in anonymously and writes
/// `csStations/{uid}` with `approved: false` and a 6-character pairing code.
/// It stays inert until the owner types that code into the dashboard, which
/// flips `approved` to true. That handshake replaces the old arrangement where
/// the app had to be shipped with a backend URL and a shared token baked in.
@MainActor
final class StationConfig: ObservableObject {
    private enum Key {
        static let refreshToken = "station.firebase.refreshToken"
        static let uid = "station.firebase.uid"
        static let pairingCode = "station.pairingCode"
    }

    @Published private(set) var uid: String?
    @Published private(set) var pairingCode: String?
    @Published private(set) var approved = false
    @Published private(set) var lastError: String?

    let config = FirebaseREST.Config.fromBundle()

    private var session: FirebaseREST.Session?

    static let shared = StationConfig()

    init() {
        let defaults = UserDefaults.standard
        uid = defaults.string(forKey: Key.uid)
        pairingCode = defaults.string(forKey: Key.pairingCode)
    }

    var isRegistered: Bool { uid != nil }

    /// Ambiguous characters are left out so staff reading a code off the screen
    /// and an owner typing it into the dashboard agree on what they saw.
    private static func makePairingCode() -> String {
        let alphabet = Array("ABCDEFGHJKLMNPQRSTUVWXYZ23456789")
        return String((0..<6).map { _ in alphabet.randomElement()! })
    }

    /// A valid ID token, refreshing or signing in as needed.
    ///
    /// `force` is used right after pairing: approval is carried as a custom
    /// claim, and claims only appear in a freshly minted token.
    func idToken(force: Bool = false) async throws -> String {
        if !force, let session, session.expiresAt > Date() {
            return session.idToken
        }
        if let refreshToken = UserDefaults.standard.string(forKey: Key.refreshToken) {
            do {
                let refreshed = try await FirebaseREST.refresh(config: config, refreshToken: refreshToken)
                store(refreshed)
                return refreshed.idToken
            } catch let error as FirebaseREST.FirebaseError where error.isIdentityGone {
                // The owner revoked this station, or its identity was deleted
                // server-side. Retrying the dead token forever would leave the
                // station bricked on a red screen with nobody on site able to
                // fix it, so start over as a new station and show a fresh
                // pairing code.
                resetIdentity()
            }
        }
        let fresh = try await FirebaseREST.signInAnonymously(config: config)
        store(fresh)
        return fresh.idToken
    }

    /// Forget this station's Firebase identity but keep the pairing code, so
    /// staff see the same six letters they may already have read out.
    private func resetIdentity() {
        session = nil
        UserDefaults.standard.removeObject(forKey: Key.refreshToken)
        UserDefaults.standard.removeObject(forKey: Key.uid)
        uid = nil
        approved = false
    }

    private func store(_ session: FirebaseREST.Session) {
        self.session = session
        UserDefaults.standard.set(session.refreshToken, forKey: Key.refreshToken)
        UserDefaults.standard.set(session.localId, forKey: Key.uid)
        uid = session.localId
    }

    /// Sign in, create the station document if this device has never registered,
    /// and report whether the owner has approved it.
    func registerAndRefresh(name: String = "Station") async {
        do {
            let token = try await idToken()
            guard let uid else { return }

            let existing = try await FirebaseREST.getDocument(
                config: config, idToken: token, collection: "csStations", documentId: uid
            )

            if let existing {
                approved = boolField(existing["approved"]) ?? false
                // The document says approved but this token predates the claim
                // the worker minted — refresh so uploads are actually allowed.
                if approved, !tokenHasApprovalClaim() {
                    _ = try? await idToken(force: true)
                }
                if let code = stringField(existing["pairingCode"]) {
                    pairingCode = code
                    UserDefaults.standard.set(code, forKey: Key.pairingCode)
                }
                // Liveness for the dashboard's station card.
                try? await FirebaseREST.patchDocument(
                    config: config, idToken: token, collection: "csStations", documentId: uid,
                    fields: ["lastSeenAt": Date(), "appVersion": Self.appVersion]
                )
            } else {
                let code = pairingCode ?? Self.makePairingCode()
                try await FirebaseREST.createDocument(
                    config: config, idToken: token, collection: "csStations", documentId: uid,
                    fields: [
                        "approved": false,
                        "pairingCode": code,
                        "name": name,
                        "appVersion": Self.appVersion,
                        "createdAt": Date(),
                        "lastSeenAt": Date(),
                    ]
                )
                pairingCode = code
                UserDefaults.standard.set(code, forKey: Key.pairingCode)
                approved = false
            }
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    static var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0"
    }

    /// Reads `stationApproved` out of the current ID token without verifying
    /// it — the server is what enforces the claim; this only decides whether a
    /// refresh is worth doing.
    private func tokenHasApprovalClaim() -> Bool {
        guard let token = session?.idToken else { return false }
        let parts = token.split(separator: ".")
        guard parts.count == 3 else { return false }

        var base64 = String(parts[1])
            .replacingOccurrences(of: "-", with: "+")
            .replacingOccurrences(of: "_", with: "/")
        while base64.count % 4 != 0 { base64 += "=" }

        guard let data = Data(base64Encoded: base64),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return false
        }
        return json["stationApproved"] as? Bool == true
    }

    // Firestore REST returns typed values — unwrap the two shapes used here.
    private func stringField(_ value: Any?) -> String? {
        (value as? [String: Any])?["stringValue"] as? String
    }

    private func boolField(_ value: Any?) -> Bool? {
        (value as? [String: Any])?["booleanValue"] as? Bool
    }
}
