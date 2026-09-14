import Foundation
import os

/// Thin wrapper over os.Logger. Never pass a JWT, pair token, or Wi-Fi
/// password to these functions. Use `Log.redacted` for anything secret.
enum Log {
    private static let subsystem = "ai.contentstation.wall"

    static let app = Logger(subsystem: subsystem, category: "app")
    static let state = Logger(subsystem: subsystem, category: "state")
    static let capture = Logger(subsystem: subsystem, category: "capture")
    static let network = Logger(subsystem: subsystem, category: "network")
    static let upload = Logger(subsystem: subsystem, category: "upload")
    static let pairing = Logger(subsystem: subsystem, category: "pairing")

    /// Replaces a secret with a fixed marker so it can never leak into logs.
    static func redacted(_ value: String?) -> String {
        guard let value, !value.isEmpty else { return "<empty>" }
        return "<redacted \(value.count) chars>"
    }
}
