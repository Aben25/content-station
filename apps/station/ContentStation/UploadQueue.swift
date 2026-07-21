import Foundation

struct UploadItem: Identifiable, Equatable {
    enum Status: Equatable {
        case pending
        case uploading(Double) // 0...1
        case uploaded(captureId: String)
        case failed(String)
    }

    let id = UUID()
    let fileURL: URL
    var status: Status = .pending

    var filename: String { fileURL.lastPathComponent }
}

/// Uploads saved captures to Cloud Storage and records them in Firestore,
/// deleting the local copy only once both have succeeded. Survives relaunch:
/// pending files are re-scanned from disk on init, so recordings are never
/// silently lost.
///
/// Nothing here needs a route into the Mac. The station pushes to Firebase and
/// the worker pulls from it, which is why the tunnel and the fixed hostname are
/// gone.
@MainActor
final class UploadQueue: ObservableObject {
    @Published private(set) var items: [UploadItem] = []

    private let station: StationConfig
    private var isProcessing = false

    // Default argument is resolved in the initialiser body, not at the call
    // site, so the main-actor `shared` is only touched from the main actor.
    init(station: StationConfig? = nil) {
        self.station = station ?? .shared
        rescanFromDisk()
        NotificationCenter.default.addObserver(
            forName: .captureSaved,
            object: nil,
            queue: .main
        ) { [weak self] note in
            guard let url = note.userInfo?["url"] as? URL else { return }
            Task { @MainActor in
                self?.enqueue(url)
            }
        }
    }

    /// Free disk space for the station health screen (bytes).
    func freeDiskSpace() -> Int64 {
        let url = URL(fileURLWithPath: NSHomeDirectory())
        let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return Int64(values?.volumeAvailableCapacityForImportantUsage ?? 0)
    }

    func rescanFromDisk() {
        let onDisk = CaptureStore.pendingCaptures()
        let known = Set(items.map { $0.fileURL })
        for url in onDisk where !known.contains(url) {
            items.append(UploadItem(fileURL: url))
        }
        process()
    }

    func enqueue(_ url: URL) {
        guard !items.contains(where: { $0.fileURL == url }) else { return }
        items.append(UploadItem(fileURL: url))
        process()
    }

    func retry(_ item: UploadItem) {
        guard let idx = items.firstIndex(where: { $0.id == item.id }) else { return }
        items[idx].status = .pending
        process()
    }

    var pendingCount: Int {
        items.filter { if case .uploaded = $0.status { return false } else { return true } }.count
    }

    // MARK: - Processing

    private func process() {
        guard !isProcessing,
              let idx = items.firstIndex(where: { $0.status == .pending }) else { return }

        // Unpaired stations keep recording and keep the footage; uploads resume
        // once the owner approves this station.
        guard station.approved else { return }

        isProcessing = true
        let item = items[idx]
        items[idx].status = .uploading(0)

        Task {
            do {
                let captureId = try await upload(item.fileURL) { [weak self] progress in
                    Task { @MainActor in
                        self?.setStatus(itemID: item.id, status: .uploading(progress))
                    }
                }
                setStatus(itemID: item.id, status: .uploaded(captureId: captureId))
                // Firebase confirmed both writes — safe to remove the local file.
                CaptureStore.delete(item.fileURL)
            } catch {
                setStatus(itemID: item.id, status: .failed(error.localizedDescription))
            }
            isProcessing = false
            process() // next item
        }
    }

    private func setStatus(itemID: UUID, status: UploadItem.Status) {
        guard let idx = items.firstIndex(where: { $0.id == itemID }) else { return }
        items[idx].status = status
    }

    // MARK: - Firebase

    /// Storage object first, Firestore document second. That order matters: the
    /// worker claims on the document, so a document only ever appears once its
    /// footage is fully uploaded.
    private func upload(_ fileURL: URL,
                        progress: @escaping (Double) -> Void) async throws -> String {
        let captureId = UUID().uuidString.lowercased()
        let storagePath = "captures/\(captureId)/raw.mp4"
        let token = try await station.idToken()
        guard let uid = station.uid else {
            throw FirebaseREST.FirebaseError.malformedResponse
        }

        progress(0.1)
        try await FirebaseREST.upload(
            config: station.config,
            idToken: token,
            objectPath: storagePath,
            fileURL: fileURL
        )

        progress(0.8)
        let bytes = (try? FileManager.default.attributesOfItem(atPath: fileURL.path)[.size] as? Int) ?? 0
        try await FirebaseREST.createDocument(
            config: station.config,
            idToken: token,
            collection: "csCaptures",
            documentId: captureId,
            fields: [
                "stationId": uid,
                "status": "uploaded",
                "storagePath": storagePath,
                "bytes": bytes ?? 0,
                "createdAt": Date(),
                "updatedAt": Date(),
            ]
        )
        progress(1.0)
        return captureId
    }
}
