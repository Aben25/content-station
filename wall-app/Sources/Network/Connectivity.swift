import Combine
import Foundation
import Network

/// Tracks consecutive failures of heartbeat and config calls and derives the
/// no internet display level after `Product.nointernetMinutes`, then the long
/// variant after `Product.nointernetLongMinutes`. Also watches the network
/// path to describe Wi-Fi in heartbeats.
@MainActor
final class Connectivity: ObservableObject {
    @Published private(set) var level: StateMachine.ConnectivityLevel = .online
    @Published private(set) var consecutiveFailures = 0

    private(set) var firstFailureAt: Date?
    private var pathStatus: NWPath.Status = .satisfied
    private var usesWifi = true
    private let monitor = NWPathMonitor()
    private var timer: Timer?

    init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let status = path.status
            let wifi = path.usesInterfaceType(.wifi)
            Task { @MainActor in
                self?.pathStatus = status
                self?.usesWifi = wifi
            }
        }
        monitor.start(queue: DispatchQueue(label: "ai.contentstation.wall.path"))
        timer = Timer.scheduledTimer(withTimeInterval: 5, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.evaluate() }
        }
    }

    deinit {
        timer?.invalidate()
        monitor.cancel()
    }

    func recordSuccess() {
        consecutiveFailures = 0
        firstFailureAt = nil
        evaluate()
    }

    func recordFailure() {
        consecutiveFailures += 1
        if firstFailureAt == nil { firstFailureAt = Date() }
        evaluate()
    }

    private func evaluate() {
        let newLevel: StateMachine.ConnectivityLevel
        if let firstFailureAt {
            let minutes = Date().timeIntervalSince(firstFailureAt) / 60
            if minutes >= Double(Product.nointernetLongMinutes) {
                newLevel = .noInternetLong
            } else if minutes >= Double(Product.nointernetMinutes) {
                newLevel = .noInternet
            } else {
                newLevel = .online
            }
        } else {
            newLevel = .online
        }
        if newLevel != level { level = newLevel }
    }

    /// The word the backend expects: strong, good, weak, none. iOS exposes no
    /// signal strength, so this is derived from the path and recent failures.
    var wifiWord: String {
        guard pathStatus == .satisfied else { return "none" }
        if consecutiveFailures > 0 { return "weak" }
        return usesWifi ? "strong" : "good"
    }
}
