import Foundation
import UIKit

/// The device serial is a UUID generated once and kept in the Keychain. The
/// short code shown while waiting is derived from it and used only in support
/// conversations.
struct DeviceIdentity {
    let serial: String

    static func load() -> DeviceIdentity {
        if let existing = Keychain.string(for: .deviceSerial), !existing.isEmpty {
            return DeviceIdentity(serial: existing)
        }
        let fresh = UUID().uuidString
        Keychain.set(fresh, for: .deviceSerial)
        return DeviceIdentity(serial: fresh)
    }

    /// First four characters of the UUID, uppercased, with the ambiguous
    /// characters 0, O, 1, and I mapped to characters that are not confused
    /// with each other. The mapping is fixed so the code never changes.
    var shortCode: String {
        DeviceIdentity.shortCode(from: serial)
    }

    static func shortCode(from serial: String) -> String {
        let cleaned = serial.replacingOccurrences(of: "-", with: "").uppercased()
        let prefix = cleaned.prefix(4)
        let mapped = prefix.map { character -> Character in
            switch character {
            case "0": return "8"
            case "O": return "Q"
            case "1": return "7"
            case "I": return "J"
            default: return character
            }
        }
        return String(mapped)
    }

    static var model: String {
        var systemInfo = utsname()
        uname(&systemInfo)
        let machine = withUnsafePointer(to: &systemInfo.machine) { pointer in
            pointer.withMemoryRebound(to: CChar.self, capacity: 1) { String(cString: $0) }
        }
        if machine == "arm64" || machine == "x86_64" {
            return "Simulator (\(UIDevice.current.model))"
        }
        return machine
    }

    static var appVersion: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "0"
        let build = info?["CFBundleVersion"] as? String ?? "0"
        return "\(short) (\(build))"
    }
}
