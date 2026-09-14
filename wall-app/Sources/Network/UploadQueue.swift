import Foundation

/// Persisted upload queue. Each segment goes through three idempotent steps:
/// get a signed upload url, PUT the file with a background URLSession, then
/// call segment/complete. Files are deleted after complete or after
/// `Product.rawRetentionHours`, whichever comes first.
final class UploadQueue: NSObject {
    struct Item: Codable, Equatable {
        var deviceID: String?
        var quarantined: Bool?
        var id: String
        var fileName: String
        var startTs: String
        var endTs: String
        var bytes: Int
        var width: Int
        var height: Int
        var fps: Int
        var path: String?
        var uploadUrl: String?
        var expiresAt: String?
        var uploaded = false
        var attempts = 0
        var nextAttemptAt = Date()
        var inFlight = false
        var createdAt = Date()
    }

    static let sessionIdentifier = "ai.contentstation.wall.uploads"
    static let minimumFreeBytes: Int64 = 1_000_000_000

    /// Set by the app delegate when iOS relaunches the app for the session.
    var backgroundCompletionHandler: (() -> Void)?
    /// Called on the main thread when a segment/complete succeeds.
    var onSegmentCompleted: ((Item) -> Void)?
    var onUnauthorized: (() -> Void)?
    var onConnectivity: ((Bool) -> Void)?

    private let api: ApiClient
    private let segmentsDirectory: URL
    private let queueFile: URL
    private let queue = DispatchQueue(label: "ai.contentstation.wall.uploadqueue")
    private var items: [Item] = []
    private var session: URLSession!
    private var processing = false
    private var activeDeviceID: String?
    private var activeToken: String?
    private var processTask: Task<Void, Never>?

    func setPairing(deviceID: String?, token: String?) {
        queue.sync {
            if activeDeviceID != deviceID || activeToken != token { processTask?.cancel() }
            activeDeviceID = deviceID
            activeToken = token
            for index in items.indices where !UploadAuthorization.permits(origin: items[index].deviceID, active: deviceID, token: token) {
                items[index].quarantined = true
                items[index].inFlight = false
            }
            save()
        }
        session.getAllTasks { tasks in
            for task in tasks {
                guard let id = task.taskDescription, let item = self.item(id: id), self.credentials(for: item) != nil else { task.cancel(); continue }
            }
        }
        kick()
    }

    private func credentials(for item: Item) -> String? {
        queue.sync {
            guard let current = items.first(where: { $0.id == item.id }), current.quarantined != true,
                  UploadAuthorization.permits(origin: current.deviceID, active: activeDeviceID, token: activeToken) else { return nil }
            return activeToken
        }
    }

    init(api: ApiClient, segmentsDirectory: URL, supportDirectory: URL) {
        self.api = api
        self.segmentsDirectory = segmentsDirectory
        queueFile = supportDirectory.appendingPathComponent("uploads.json")
        super.init()
        let configuration = URLSessionConfiguration.background(withIdentifier: UploadQueue.sessionIdentifier)
        configuration.isDiscretionary = false
        configuration.sessionSendsLaunchEvents = true
        configuration.allowsCellularAccess = true
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        load()
        reconcileInFlight()
    }

    // MARK: Public

    func enqueue(_ file: SegmentFile) {
        queue.async {
            let item = Item(
                deviceID: file.deviceID,
                quarantined: !UploadAuthorization.permits(origin: file.deviceID, active: self.activeDeviceID, token: self.activeToken),
                id: UUID().uuidString,
                fileName: file.url.lastPathComponent,
                startTs: TimeFormat.iso8601(file.startDate),
                endTs: TimeFormat.iso8601(file.endDate),
                bytes: file.bytes,
                width: file.width,
                height: file.height,
                fps: file.fps
            )
            self.items.append(item)
            self.save()
            Log.upload.info("queued \(item.fileName, privacy: .public)")
        }
        kick()
    }

    /// Process anything due. Safe to call often.
    func kick() {
        queue.async {
            guard !self.processing else { return }
            self.processing = true
            self.processTask = Task {
                await self.processDue()
                self.queue.async { self.processing = false }
            }
        }
    }

    /// Deletes files past retention and stray files the queue never saw.
    func cleanup(retentionHours: Int = Product.rawRetentionHours) {
        queue.async {
            let cutoff = Date().addingTimeInterval(-TimeInterval(retentionHours) * 3600)
            var kept: [Item] = []
            for item in self.items {
                let start = TimeFormat.parseISO8601(item.startTs) ?? item.createdAt
                if start < cutoff {
                    self.removeFile(named: item.fileName)
                    Log.upload.info("expired \(item.fileName, privacy: .public)")
                } else {
                    kept.append(item)
                }
            }
            if kept != self.items {
                self.items = kept
                self.save()
                self.session.getAllTasks { tasks in
                    for task in tasks {
                        if let id = task.taskDescription, self.item(id: id) == nil { task.cancel() }
                    }
                }
            }
            let known = Set(self.items.map(\.fileName))
            let files = (try? FileManager.default.contentsOfDirectory(at: self.segmentsDirectory, includingPropertiesForKeys: [.contentModificationDateKey])) ?? []
            for url in files where url.pathExtension == "mp4" && !known.contains(url.lastPathComponent) {
                let modified = (try? url.resourceValues(forKeys: [.contentModificationDateKey]).contentModificationDate) ?? Date()
                if modified < cutoff {
                    try? FileManager.default.removeItem(at: url)
                }
            }
        }
    }

    /// Adopts playable files left by a crash, using the file name for the
    /// start time and the modification date for the end.
    func adoptOrphans(minimumSeconds: TimeInterval = 4) {
        queue.async {
            let known = Set(self.items.map(\.fileName))
            let files = (try? FileManager.default.contentsOfDirectory(at: self.segmentsDirectory, includingPropertiesForKeys: [.contentModificationDateKey, .fileSizeKey])) ?? []
            var added = 0
            for url in files where url.pathExtension == "mp4" && !known.contains(url.lastPathComponent) {
                let values = try? url.resourceValues(forKeys: [.contentModificationDateKey, .fileSizeKey])
                guard let millis = Double(url.deletingPathExtension().lastPathComponent) else { continue }
                let start = Date(timeIntervalSince1970: millis / 1000)
                let end = values?.contentModificationDate ?? start
                guard end.timeIntervalSince(start) >= minimumSeconds, let size = values?.fileSize, size > 0 else {
                    try? FileManager.default.removeItem(at: url)
                    continue
                }
                let item = Item(
                    deviceID: nil,
                    quarantined: true,
                    id: UUID().uuidString,
                    fileName: url.lastPathComponent,
                    startTs: TimeFormat.iso8601(start),
                    endTs: TimeFormat.iso8601(end),
                    bytes: size,
                    width: Product.captureHeight,
                    height: Product.captureWidth,
                    fps: Product.captureFps
                )
                self.items.append(item)
                added += 1
            }
            if added > 0 {
                self.save()
                Log.upload.info("adopted \(added, privacy: .public) orphan segments")
            }
        }
        kick()
    }

    var pendingCount: Int {
        queue.sync { items.count }
    }

    /// Free space on the data volume.
    static func freeBytes() -> Int64 {
        let url = URL(fileURLWithPath: NSHomeDirectory())
        let values = try? url.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey])
        return values?.volumeAvailableCapacityForImportantUsage ?? 0
    }

    static func freeMegabytes() -> Int {
        Int(freeBytes() / 1_000_000)
    }

    // MARK: Processing

    private func processDue() async {
        let due: [Item] = queue.sync {
            let now = Date()
            return items.filter { !$0.inFlight && $0.nextAttemptAt <= now }
        }
        for item in due {
            guard !Task.isCancelled else { return }
            await process(item)
        }
    }

    private func process(_ original: Item) async {
        guard !Task.isCancelled, let token = credentials(for: original) else { return }
        var item = original
        let fileURL = segmentsDirectory.appendingPathComponent(item.fileName)
        guard FileManager.default.fileExists(atPath: fileURL.path) else {
            remove(id: item.id)
            return
        }
        do {
            if item.uploaded {
                let request = SegmentCompleteRequest(
                    path: item.path ?? "",
                    startTs: item.startTs,
                    endTs: item.endTs,
                    bytes: item.bytes,
                    width: item.width,
                    height: item.height,
                    fps: item.fps
                )
                _ = try await api.segmentComplete(request, token: token)
                guard !Task.isCancelled, credentials(for: item) == token else { return }
                onConnectivity?(true)
                remove(id: item.id)
                removeFile(named: item.fileName)
                Log.upload.info("completed \(item.fileName, privacy: .public)")
                DispatchQueue.main.async { self.onSegmentCompleted?(item) }
                return
            }
            if item.uploadUrl == nil || urlExpired(item) {
                let response = try await api.segmentUploadUrl(startTs: item.startTs, endTs: item.endTs, token: token)
                guard !Task.isCancelled, credentials(for: item) == token else { return }
                onConnectivity?(true)
                item.path = response.path
                item.uploadUrl = response.uploadUrl
                item.expiresAt = response.expiresAt
                update(item)
            }
            guard let uploadUrl = item.uploadUrl.flatMap(URL.init(string:)) else {
                fail(item, reason: "bad upload url")
                return
            }
            if api.isMock {
                item.uploaded = true
                update(item)
                await process(item)
                return
            }
            var request = URLRequest(url: uploadUrl)
            request.httpMethod = "PUT"
            request.setValue("video/mp4", forHTTPHeaderField: "Content-Type")
            request.setValue("true", forHTTPHeaderField: "x-upsert")
            let task = session.uploadTask(with: request, fromFile: fileURL)
            task.taskDescription = item.id
            item.inFlight = true
            update(item)
            guard !Task.isCancelled, credentials(for: item) == token else { task.cancel(); return }
            task.resume()
            Log.upload.info("uploading \(item.fileName, privacy: .public)")
        } catch let error as ApiError {
            guard !Task.isCancelled, credentials(for: item) == token else { return }
            if case .unauthorized = error {
                queue.sync { processTask?.cancel() }
                DispatchQueue.main.async {
                    guard self.credentials(for: item) == token else { return }
                    self.onUnauthorized?()
                }
                return
            }
            if error.isConnectivityFailure { onConnectivity?(false) }
            fail(item, reason: error.description)
        } catch {
            guard !Task.isCancelled, credentials(for: item) == token else { return }
            fail(item, reason: error.localizedDescription)
        }
    }

    private func urlExpired(_ item: Item) -> Bool {
        guard let expires = item.expiresAt.flatMap(TimeFormat.parseISO8601) else { return false }
        return expires.timeIntervalSinceNow < 60
    }

    private func fail(_ item: Item, reason: String) {
        var updated = item
        updated.inFlight = false
        updated.attempts += 1
        let delay = min(300, pow(2, Double(min(updated.attempts, 8))))
        updated.nextAttemptAt = Date().addingTimeInterval(delay)
        update(updated)
        Log.upload.error("\(item.fileName, privacy: .public) attempt \(updated.attempts, privacy: .public) failed: \(reason, privacy: .public)")
    }

    // MARK: Persistence

    private func load() {
        guard let data = try? Data(contentsOf: queueFile) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        items = (try? decoder.decode([Item].self, from: data)) ?? []
    }

    private func save() {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        if let data = try? encoder.encode(items) {
            try? data.write(to: queueFile, options: .atomic)
        }
    }

    private func update(_ item: Item) {
        queue.sync {
            if let index = items.firstIndex(where: { $0.id == item.id }), items[index].quarantined != true {
                items[index] = item
            }
            save()
        }
    }

    private func remove(id: String) {
        queue.sync {
            items.removeAll { $0.id == id }
            save()
        }
    }

    private func item(id: String) -> Item? {
        queue.sync { items.first { $0.id == id } }
    }

    private func removeFile(named name: String) {
        try? FileManager.default.removeItem(at: segmentsDirectory.appendingPathComponent(name))
    }

    /// After a relaunch, clear the in flight flag on anything the background
    /// session is no longer carrying.
    private func reconcileInFlight() {
        session.getAllTasks { [weak self] tasks in
            guard let self else { return }
            let live = Set(tasks.compactMap(\.taskDescription))
            self.queue.async {
                var changed = false
                for index in self.items.indices where self.items[index].inFlight && !live.contains(self.items[index].id) {
                    self.items[index].inFlight = false
                    changed = true
                }
                if changed { self.save() }
            }
            self.kick()
        }
    }
}

extension UploadQueue: URLSessionDelegate, URLSessionTaskDelegate {
    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = task.taskDescription, let item = item(id: id), credentials(for: item) != nil else { return }
        let status = (task.response as? HTTPURLResponse)?.statusCode ?? 0
        if error == nil, (200..<300).contains(status) {
            var updated = item
            updated.inFlight = false
            updated.uploaded = true
            updated.nextAttemptAt = Date()
            update(updated)
            onConnectivity?(true)
            Log.upload.info("uploaded \(item.fileName, privacy: .public)")
            kick()
        } else if status == 401 || status == 403 {
            // Storage capability expiry does not revoke the device pairing.
            var retry = item
            retry.uploadUrl = nil
            retry.expiresAt = nil
            fail(retry, reason: "storage capability rejected; refresh URL")
        } else {
            if error != nil { onConnectivity?(false) }
            fail(item, reason: error?.localizedDescription ?? "http \(status)")
        }
    }

    func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
        DispatchQueue.main.async {
            self.backgroundCompletionHandler?()
            self.backgroundCompletionHandler = nil
        }
    }
}
