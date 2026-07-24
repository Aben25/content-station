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
    private var retryTask: Task<Void, Never>?

    /// Consecutive failures, used to back off. Nothing is ever dropped: the
    /// file stays on disk and the queue keeps trying, because a station on a
    /// slow or intermittent link should be patient rather than lossy.
    private var failureStreak = 0

    /// 5s, 15s, 45s, 2m, 5m, then every 15 minutes.
    private var retryDelay: Duration {
        let ladder: [Int] = [5, 15, 45, 120, 300]
        let seconds = failureStreak <= ladder.count ? ladder[max(0, failureStreak - 1)] : 900
        return .seconds(seconds)
    }

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
        failureStreak = 0
        process()
    }

    /// Retry everything now. Called when the station is approved, when the app
    /// returns to the foreground, and on the idle heartbeat — any of which may
    /// mean the thing that was blocking uploads has gone away.
    func kick() {
        guard station.approved else { return }
        for idx in items.indices {
            if case .failed = items[idx].status { items[idx].status = .pending }
        }
        rescanFromDisk()
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
        // once the owner approves this station and `kick()` is called.
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
                failureStreak = 0
                isProcessing = false
                process() // next item
            } catch {
                setStatus(itemID: item.id, status: .failed(error.localizedDescription))
                failureStreak += 1
                isProcessing = false
                scheduleRetry(itemID: item.id)
            }
        }
    }

    /// Put a failed item back in line after a delay. Unattended stations get no
    /// human to press retry, so this is the only thing standing between a
    /// dropped connection and footage that never arrives.
    private func scheduleRetry(itemID: UUID) {
        retryTask?.cancel()
        let delay = retryDelay
        retryTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: delay)
            guard !Task.isCancelled, let self else { return }
            if let idx = self.items.firstIndex(where: { $0.id == itemID }),
               case .failed = self.items[idx].status {
                self.items[idx].status = .pending
            }
            self.process()
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
    ///
    /// The whole operation is idempotent. The capture id comes from the file
    /// name (already a UUID from the recorder), so a retry after a half-failed
    /// attempt overwrites the same Storage object instead of orphaning it, and
    /// an "already exists" on the document means a previous attempt actually
    /// succeeded and only the response was lost.
    private func upload(_ fileURL: URL,
                        progress: @escaping (Double) -> Void) async throws -> String {
        let captureId = fileURL.deletingPathExtension().lastPathComponent.lowercased()
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
        let attributes = try? FileManager.default.attributesOfItem(atPath: fileURL.path)
        let bytes = (attributes?[.size] as? Int) ?? 0
        do {
            try await FirebaseREST.createDocument(
                config: station.config,
                idToken: token,
                collection: "csCaptures",
                documentId: captureId,
                fields: [
                    "stationId": uid,
                    "status": "uploaded",
                    "storagePath": storagePath,
                    "bytes": bytes,
                    "createdAt": Date(),
                    "updatedAt": Date(),
                ]
            )
        } catch let error as FirebaseREST.FirebaseError where error.isAlreadyExists {
            // A previous attempt finished; this retry only re-sent the bytes.
        }
        progress(1.0)
        return captureId
    }
}
