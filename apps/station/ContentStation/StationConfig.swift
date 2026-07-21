import Foundation

/// Where this station uploads to, and the token that authorises it.
///
/// Held in UserDefaults rather than baked into the build so the repo carries no
/// secret and a TestFlight build can be pointed at any backend. Staff enter it
/// once via the setup sheet; the pairing flow (6-char code) replaces the manual
/// entry later without changing anything downstream of `baseURL`/`token`.
@MainActor
final class StationConfig: ObservableObject {
    private enum Key {
        static let baseURL = "station.baseURL"
        static let token = "station.token"
    }

    @Published private(set) var baseURL: URL?
    @Published private(set) var token: String?

    static let shared = StationConfig()

    init() {
        let defaults = UserDefaults.standard
        if let stored = defaults.string(forKey: Key.baseURL) {
            baseURL = URL(string: stored)
        }
        token = defaults.string(forKey: Key.token)
    }

    var isConfigured: Bool { baseURL != nil && !(token ?? "").isEmpty }

    /// Returns nil when the input is unusable, so the setup sheet can complain.
    @discardableResult
    func save(urlString: String, token newToken: String) -> Bool {
        let trimmedURL = urlString.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedToken = newToken.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let url = URL(string: trimmedURL),
              url.scheme == "https" || url.host == "localhost" || url.host == "127.0.0.1",
              !trimmedToken.isEmpty else { return false }

        UserDefaults.standard.set(url.absoluteString, forKey: Key.baseURL)
        UserDefaults.standard.set(trimmedToken, forKey: Key.token)
        baseURL = url
        token = trimmedToken
        return true
    }

    func clear() {
        UserDefaults.standard.removeObject(forKey: Key.baseURL)
        UserDefaults.standard.removeObject(forKey: Key.token)
        baseURL = nil
        token = nil
    }
}
