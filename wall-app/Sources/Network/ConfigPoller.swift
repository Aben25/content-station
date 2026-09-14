import Foundation

/// Long polls GET /device/config with `since` and `wait=25`, re-issuing the
/// request right after each response. Backs off exponentially on failure.
final class ConfigPoller {
    private let api: ApiClient
    private var task: Task<Void, Never>?
    private var since: String?

    var onConfig: ((DeviceConfig) -> Void)?
    var onFailure: ((ApiError) -> Void)?
    var onSuccess: (() -> Void)?
    var onUnauthorized: (() -> Void)?

    init(api: ApiClient) {
        self.api = api
    }

    var isRunning: Bool { task != nil }

    func start(since initial: String?) {
        guard task == nil else { return }
        since = initial
        task = Task { [weak self] in
            await self?.loop()
        }
    }

    func stop() {
        task?.cancel()
        task = nil
    }

    private func loop() async {
        var backoff: TimeInterval = 1
        while !Task.isCancelled {
            do {
                let config = try await api.config(since: since, wait: 25)
                guard !Task.isCancelled else { return }
                since = config.updatedAt ?? since
                backoff = 1
                onSuccess?()
                onConfig?(config)
            } catch let error as ApiError {
                if Task.isCancelled { return }
                Log.network.error("config poll failed: \(error.description, privacy: .public)")
                if case .unauthorized = error {
                    onUnauthorized?()
                    return
                }
                onFailure?(error)
                try? await Task.sleep(nanoseconds: UInt64(backoff * 1_000_000_000))
                backoff = min(60, backoff * 2)
            } catch {
                if Task.isCancelled { return }
                try? await Task.sleep(nanoseconds: UInt64(backoff * 1_000_000_000))
                backoff = min(60, backoff * 2)
            }
        }
    }
}
