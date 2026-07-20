import Foundation

/// Local persistence for captures. Files live in the app's Documents folder
/// and stay there until the server confirms the upload (spec: "the local file
/// must remain until the server verifies the upload").
enum CaptureStore {
    static func recordingsDirectory() throws -> URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0]
        let dir = docs.appendingPathComponent("Captures", isDirectory: true)
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir
    }

    static func pendingCaptures() -> [URL] {
        guard let dir = try? recordingsDirectory(),
              let files = try? FileManager.default.contentsOfDirectory(
                  at: dir,
                  includingPropertiesForKeys: [.fileSizeKey],
                  options: [.skipsHiddenFiles]
              ) else { return [] }
        return files.filter { $0.pathExtension == "mp4" }
                    .sorted { $0.lastPathComponent < $1.lastPathComponent }
    }

    static func delete(_ url: URL) {
        try? FileManager.default.removeItem(at: url)
    }
}
