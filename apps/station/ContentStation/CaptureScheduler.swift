import Foundation

/// Records on a fixed interval once staff press Start.
///
/// The station is unattended: nobody is going to remember to tap a button
/// during a shift, so the only human action is Start on day one. Running state
/// and interval persist, and the schedule resumes by itself after a relaunch,
/// a crash, or a power cut — otherwise a station that rebooted overnight would
/// quietly stop filming and nobody would notice for a week.
@MainActor
final class CaptureScheduler: ObservableObject {
    /// Options staff can pick between. Longer is usually better: every capture
    /// becomes a draft somebody has to review.
    static let intervalOptions: [Int] = [10, 20, 30, 60, 120]

    private enum Key {
        static let running = "scheduler.running"
        static let intervalMinutes = "scheduler.intervalMinutes"
        static let nextFireAt = "scheduler.nextFireAt"
    }

    @Published private(set) var isRunning = false
    @Published private(set) var intervalMinutes: Int
    @Published private(set) var secondsUntilNext: Int = 0
    @Published private(set) var capturesThisSession = 0

    /// Set by the app; returns false when the camera is not in a state to record.
    var onFire: (() -> Bool)?

    private var ticker: Task<Void, Never>?
    private var nextFireAt: Date?

    init() {
        let stored = UserDefaults.standard.integer(forKey: Key.intervalMinutes)
        intervalMinutes = Self.intervalOptions.contains(stored) ? stored : 30
        isRunning = UserDefaults.standard.bool(forKey: Key.running)
        if isRunning {
            // Resume the existing schedule rather than restarting the clock, so
            // a relaunch does not postpone the next capture indefinitely.
            let stamp = UserDefaults.standard.double(forKey: Key.nextFireAt)
            let restored = stamp > 0 ? Date(timeIntervalSince1970: stamp) : nil
            nextFireAt = (restored.map { $0 > Date() ? $0 : Date().addingTimeInterval(5) })
                ?? Date().addingTimeInterval(TimeInterval(intervalMinutes * 60))
            startTicking()
        }
    }

    func start() {
        isRunning = true
        capturesThisSession = 0
        UserDefaults.standard.set(true, forKey: Key.running)
        scheduleNext(after: 5) // first clip shortly after Start, so staff see it work
        startTicking()
    }

    func stop() {
        isRunning = false
        nextFireAt = nil
        secondsUntilNext = 0
        UserDefaults.standard.set(false, forKey: Key.running)
        UserDefaults.standard.removeObject(forKey: Key.nextFireAt)
        ticker?.cancel()
        ticker = nil
    }

    func setInterval(_ minutes: Int) {
        intervalMinutes = minutes
        UserDefaults.standard.set(minutes, forKey: Key.intervalMinutes)
        if isRunning { scheduleNext(after: TimeInterval(minutes * 60)) }
    }

    private func scheduleNext(after seconds: TimeInterval) {
        let fireAt = Date().addingTimeInterval(seconds)
        nextFireAt = fireAt
        UserDefaults.standard.set(fireAt.timeIntervalSince1970, forKey: Key.nextFireAt)
    }

    /// One second-resolution loop drives both the countdown and the firing, so
    /// there is no separate timer to fall out of sync.
    private func startTicking() {
        ticker?.cancel()
        ticker = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                guard let self, self.isRunning else { return }
                if let next = self.nextFireAt {
                    let remaining = Int(next.timeIntervalSinceNow.rounded(.up))
                    self.secondsUntilNext = max(0, remaining)
                    if remaining <= 0 { self.fire() }
                }
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    private func fire() {
        let started = onFire?() ?? false
        if started { capturesThisSession += 1 }
        // Reschedule either way. A camera that was busy or recovering should
        // not stop the schedule — it just misses this slot.
        scheduleNext(after: TimeInterval(intervalMinutes * 60))
    }
}
