import Foundation
import Security

/// Generic password Keychain access. Items survive app reinstall on the same
/// device and are available after the first unlock, which is what a phone that
/// relaunches after a power cut needs.
///
/// Unsigned simulator builds have no application identifier entitlement, so
/// the data protection Keychain refuses them with errSecMissingEntitlement.
/// Only in that case values fall back to a file in Application Support so
/// the simulator keeps a stable serial between launches.
enum Keychain {
    private static let service = "ai.contentstation.wall"

    enum Key: String {
        case deviceSerial = "device_serial"
        case deviceJWT = "device_jwt"
        case deviceId = "device_id"
    }

    static func data(for key: Key) -> Data? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        if status == errSecMissingEntitlement {
            return FallbackStore.read(key)
        }
        guard status == errSecSuccess else { return nil }
        return result as? Data
    }

    static func string(for key: Key) -> String? {
        guard let data = data(for: key) else { return nil }
        return String(data: data, encoding: .utf8)
    }

    @discardableResult
    static func set(_ value: String, for key: Key) -> Bool {
        set(Data(value.utf8), for: key)
    }

    @discardableResult
    static func set(_ value: Data, for key: Key) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]
        let attributes: [String: Any] = [
            kSecValueData as String: value,
            kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        ]
        let update = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
        if update == errSecSuccess { return true }
        if update == errSecMissingEntitlement {
            return FallbackStore.write(value, key)
        }
        if update == errSecItemNotFound {
            var insert = query
            attributes.forEach { insert[$0.key] = $0.value }
            let add = SecItemAdd(insert as CFDictionary, nil)
            if add == errSecSuccess { return true }
            if add == errSecMissingEntitlement {
                return FallbackStore.write(value, key)
            }
            Log.app.error("keychain add failed \(add, privacy: .public) for \(key.rawValue, privacy: .public)")
            return false
        }
        Log.app.error("keychain update failed \(update, privacy: .public) for \(key.rawValue, privacy: .public)")
        return false
    }

    @discardableResult
    static func delete(_ key: Key) -> Bool {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: key.rawValue,
        ]
        let status = SecItemDelete(query as CFDictionary)
        if status == errSecMissingEntitlement {
            return FallbackStore.delete(key)
        }
        return status == errSecSuccess || status == errSecItemNotFound
    }

    /// File store used only when the Keychain reports a missing entitlement.
    private enum FallbackStore {
        private static var directory: URL {
            let url = AppDirectories.support.appendingPathComponent("keychain-fallback", isDirectory: true)
            try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
            return url
        }

        private static func url(_ key: Key) -> URL {
            directory.appendingPathComponent(key.rawValue)
        }

        static func read(_ key: Key) -> Data? {
            try? Data(contentsOf: url(key))
        }

        static func write(_ value: Data, _ key: Key) -> Bool {
            Log.app.warning("keychain unavailable, using file fallback for \(key.rawValue, privacy: .public)")
            do {
                try value.write(to: url(key), options: [.atomic, .completeFileProtection])
                return true
            } catch {
                return false
            }
        }

        static func delete(_ key: Key) -> Bool {
            try? FileManager.default.removeItem(at: url(key))
            return true
        }
    }
}
