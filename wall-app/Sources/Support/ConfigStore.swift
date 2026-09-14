import Foundation

/// Keeps the last Config on disk so a relaunch after a power cut knows the
/// hours, pause, and timezone before the network comes back.
enum ConfigStore {
    private static var fileURL: URL {
        AppDirectories.support.appendingPathComponent("config.json")
    }

    static func load() -> DeviceConfig? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        return try? JSONDecoder().decode(DeviceConfig.self, from: data)
    }

    static func save(_ config: DeviceConfig) {
        guard let data = try? JSONEncoder().encode(config) else { return }
        try? data.write(to: fileURL, options: .atomic)
    }

    static func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }
}

/// Application Support layout. Segments live in their own folder.
enum AppDirectories {
    static let support: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first
            ?? URL(fileURLWithPath: NSTemporaryDirectory())
        let url = base.appendingPathComponent("ContentStationWall", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        var values = URLResourceValues()
        values.isExcludedFromBackup = true
        var mutable = url
        try? mutable.setResourceValues(values)
        return url
    }()

    static let segments: URL = {
        let url = support.appendingPathComponent("segments", isDirectory: true)
        try? FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
        return url
    }()
}
