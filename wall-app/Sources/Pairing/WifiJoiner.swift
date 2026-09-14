import Foundation
import NetworkExtension

enum WifiJoinError: Error {
    case failed(String)
}

/// Joins the shop Wi-Fi with NEHotspotConfiguration. Already being on the
/// network counts as success.
enum WifiJoiner {
    static func join(ssid: String, password: String) async throws {
        #if targetEnvironment(simulator)
        Log.pairing.info("simulator: skipping Wi-Fi join")
        return
        #else
        if LaunchArguments.mockApi {
            Log.pairing.info("mock: skipping Wi-Fi join")
            return
        }
        let configuration: NEHotspotConfiguration
        if password.isEmpty {
            configuration = NEHotspotConfiguration(ssid: ssid)
        } else {
            configuration = NEHotspotConfiguration(ssid: ssid, passphrase: password, isWEP: false)
        }
        configuration.joinOnce = false
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            NEHotspotConfigurationManager.shared.apply(configuration) { error in
                guard let error else {
                    continuation.resume()
                    return
                }
                let nsError = error as NSError
                if nsError.domain == NEHotspotConfigurationErrorDomain,
                   nsError.code == NEHotspotConfigurationError.alreadyAssociated.rawValue {
                    continuation.resume()
                    return
                }
                Log.pairing.error("wifi join failed: \(nsError.code, privacy: .public)")
                continuation.resume(throwing: WifiJoinError.failed(nsError.localizedDescription))
            }
        }
        #endif
    }
}
