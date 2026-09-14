import Foundation

/// The QR the owner app shows: base64 of `{ v, ssid, password, pair_token }`.
struct QRPayload: Equatable {
    var version: Int
    var ssid: String
    var password: String
    var pairToken: String

    private struct Wire: Decodable {
        var v: Int
        var ssid: String
        var password: String?
        var pair_token: String
    }

    /// Decodes the raw string from the QR. Returns nil for anything that is
    /// not our payload, so random QR codes in the shop are ignored.
    static func decode(_ raw: String) -> QRPayload? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        var normalized = trimmed.replacingOccurrences(of: "\n", with: "")
        // Tolerate url safe base64 and missing padding.
        normalized = normalized.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let remainder = normalized.count % 4
        if remainder > 0 { normalized += String(repeating: "=", count: 4 - remainder) }
        guard let data = Data(base64Encoded: normalized) else { return nil }
        guard let wire = try? JSONDecoder().decode(Wire.self, from: data) else { return nil }
        guard wire.v == 1, !wire.ssid.isEmpty, !wire.pair_token.isEmpty else { return nil }
        return QRPayload(version: wire.v, ssid: wire.ssid, password: wire.password ?? "", pairToken: wire.pair_token)
    }
}
