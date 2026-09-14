import Foundation

/// Sends a heartbeat every `Product.heartbeatSeconds` regardless of state.
/// The response is a Config so the device converges even without the poll.
final class HeartbeatService {
    private let api: ApiClient
    private var task: Task<Void, Never>?

    /// Builds the body on the main actor from live device readings.
    var gather: (() async -> HeartbeatRequest)?
    var onConfig: ((DeviceConfig) -> Void)?
    var onFailure: ((ApiError) -> Void)?
    var onSuccess: (() -> Void)?
    var onUnauthorized: (() -> Void)?

    init(api: ApiClient) {
        self.api = api
    }

    func start() {
        guard task == nil else { return }
        task = Task { [weak self] in
            await self?.loop()
        }
    }

    func stop() {
        task?.cancel()
        task = nil
    }

    /// Send one heartbeat now, outside the timer.
    func sendNow() {
        Task { [weak self] in
            await self?.sendOnce()
        }
    }

    private func loop() async {
        while !Task.isCancelled {
            await sendOnce()
            try? await Task.sleep(nanoseconds: UInt64(Product.heartbeatSeconds) * 1_000_000_000)
        }
    }

    private func sendOnce() async {
        guard let gather else { return }
        let body = await gather()
        do {
            let config = try await api.heartbeat(body)
            guard !Task.isCancelled else { return }
            onSuccess?()
            onConfig?(config)
        } catch let error as ApiError {
            if Task.isCancelled { return }
            Log.network.error("heartbeat failed: \(error.description, privacy: .public)")
            if case .unauthorized = error {
                onUnauthorized?()
                return
            }
            onFailure?(error)
        } catch {
            Log.network.error("heartbeat failed: \(error.localizedDescription, privacy: .public)")
        }
    }
}
