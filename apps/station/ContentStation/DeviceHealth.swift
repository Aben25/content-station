import Foundation
import UIKit

/// The device conditions that quietly kill an unattended station.
///
/// A phone behind a counter has nobody watching it. The charger gets knocked
/// out and it films until the battery dies mid-write; the disk fills after a
/// week of dead Wi-Fi and recording starts failing; the sun hits it and iOS
/// shuts the camera down. Each of those needs the same two responses: stop
/// making things worse, and say so — on screen for staff, and in the heartbeat
/// for the owner half a world away.
@MainActor
final class DeviceHealth: ObservableObject {
    /// Recording is skipped below this much free disk. Uploads keep going —
    /// they free space; recording only consumes it.
    static let minFreeDiskBytes: Int64 = 2 * 1024 * 1024 * 1024

    /// Below this charge while unplugged, stop filming. The remaining battery
    /// is worth more as upload time than as footage nobody may ever receive.
    static let minBatteryLevel: Float = 0.15

    struct Snapshot {
        let batteryLevel: Float      // 0...1, or -1 when unknown (simulator)
        let isCharging: Bool
        let thermalSerious: Bool
        let freeDiskBytes: Int64
        /// Non-nil when capture should be skipped. The string is staff-facing.
        let captureBlocked: String?
        /// Charger out but still filming — warn, don't block.
        let warning: String?
    }

    @Published private(set) var current: Snapshot

    init() {
        UIDevice.current.isBatteryMonitoringEnabled = true
        current = Self.read()

        let center = NotificationCenter.default
        for name in [
            UIDevice.batteryStateDidChangeNotification,
            UIDevice.batteryLevelDidChangeNotification,
            ProcessInfo.thermalStateDidChangeNotification,
        ] {
            center.addObserver(self, selector: #selector(changed), name: name, object: nil)
        }
    }

    @objc private func changed() {
        Task { @MainActor in self.refresh() }
    }

    func refresh() {
        current = Self.read()
    }

    private static func read() -> Snapshot {
        let device = UIDevice.current
        let level = device.batteryLevel
        // .unknown happens in the simulator and momentarily on launch — treat
        // it as plugged in rather than blocking capture on missing data.
        let charging = device.batteryState == .charging || device.batteryState == .full
            || device.batteryState == .unknown

        let thermal = ProcessInfo.processInfo.thermalState
        let thermalSerious = thermal == .serious || thermal == .critical

        let values = try? URL(fileURLWithPath: NSHomeDirectory())
            .resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        let free = Int64(values?.volumeAvailableCapacityForImportantUsage ?? .max)

        var blocked: String?
        if free < minFreeDiskBytes {
            blocked = "Storage almost full — not recording until uploads free space"
        } else if thermal == .critical {
            blocked = "Phone too hot — paused until it cools down"
        } else if !charging, level >= 0, level < minBatteryLevel {
            blocked = "Battery low and unplugged — saving power for uploads"
        }

        var warning: String?
        if blocked == nil, !charging, level >= 0 {
            warning = "Charger unplugged — please plug the phone back in"
        } else if blocked == nil, thermalSerious {
            warning = "Phone is getting hot — keep it out of the sun"
        }

        return Snapshot(
            batteryLevel: level,
            isCharging: charging,
            thermalSerious: thermalSerious,
            freeDiskBytes: free,
            captureBlocked: blocked,
            warning: warning
        )
    }
}
