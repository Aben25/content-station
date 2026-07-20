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

/// Uploads saved captures to the backend and deletes the local copy only
/// after the server confirms. Survives relaunch: pending files are re-scanned
/// from disk on init, so recordings are never silently lost.
@MainActor
final class UploadQueue: ObservableObject {
    @Published private(set) var items: [UploadItem] = []

    /// Phase 1 default: developer machine. Override in Settings (later phase).
    var uploadBaseURL = URL(string: "http://localhost:3000")!

    private var isProcessing = false

    init() {
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
                // Server confirmed — safe to remove the local file.
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

    // MARK: - Network

    private struct UploadResponse: Decodable {
        let captureId: String
    }

    private func upload(_ fileURL: URL,
                        progress: @escaping (Double) -> Void) async throws -> String {
        var request = URLRequest(url: uploadBaseURL.appendingPathComponent("upload"))
        request.httpMethod = "POST"

        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)",
                         forHTTPHeaderField: "Content-Type")

        let fileData = try Data(contentsOf: fileURL)
        var body = Data()
        body.append("--\(boundary)\r\n")
        body.append("Content-Disposition: form-data; name=\"file\"; filename=\"\(fileURL.lastPathComponent)\"\r\n")
        body.append("Content-Type: video/mp4\r\n\r\n")
        body.append(fileData)
        body.append("\r\n--\(boundary)--\r\n")
        request.httpBody = body

        progress(0.3)
        let (data, response) = try await URLSession.shared.data(for: request)
        progress(1.0)

        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
            let code = (response as? HTTPURLResponse)?.statusCode ?? -1
            throw NSError(domain: "UploadQueue", code: code,
                          userInfo: [NSLocalizedDescriptionKey: "Server returned \(code)"])
        }
        return try JSONDecoder().decode(UploadResponse.self, from: data).captureId
    }
}

private extension Data {
    mutating func append(_ string: String) {
        append(string.data(using: .utf8)!)
    }
}
