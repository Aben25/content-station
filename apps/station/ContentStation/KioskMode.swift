import SwiftUI
import UIKit

/// Keeps an unattended, permanently-charging iPhone usable as a fixture.
///
/// Three problems this solves, none of which show up while a developer is
/// holding the phone:
///   * auto-lock turns the station into a black rectangle nobody taps
///   * a static bright UI burns into an OLED panel over weeks
///   * nothing retries uploads while the screen sits idle
@MainActor
final class KioskMode: ObservableObject {
    /// Dim (but never sleep) after this long without a tap.
    private static let idleDimAfter: TimeInterval = 90

    @Published private(set) var isDimmed = false

    private var idleTask: Task<Void, Never>?
    private var heartbeat: Task<Void, Never>?

    /// Called on a timer so the queue keeps trying without anyone present.
    var onHeartbeat: (() -> Void)?

    func start() {
        // The single most important line for a mounted station.
        UIApplication.shared.isIdleTimerDisabled = true
        noteActivity()
        startHeartbeat()
    }

    func stop() {
        UIApplication.shared.isIdleTimerDisabled = false
        idleTask?.cancel()
        heartbeat?.cancel()
    }

    /// Any touch wakes the UI back to full brightness and restarts the timer.
    func noteActivity() {
        isDimmed = false
        idleTask?.cancel()
        idleTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .seconds(Self.idleDimAfter))
            guard !Task.isCancelled else { return }
            self?.isDimmed = true
        }
    }

    /// Every few minutes: retry uploads, refresh pairing state, recover the
    /// camera session if it died. Cheap, and it is the difference between a
    /// station that heals itself and one that needs a person to visit it.
    private func startHeartbeat() {
        heartbeat?.cancel()
        heartbeat = Task { @MainActor [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(120))
                guard !Task.isCancelled else { return }
                self?.onHeartbeat?()
            }
        }
    }
}

/// Rotating suggestions so staff have something specific to film. A fixed
/// camera pointed at the same spot produces the same clip forever; prompts are
/// the cheapest fix for that.
enum CapturePrompts {
    static let all = [
        "Film a customer finding what they needed",
        "Show today's busiest moment",
        "Film new stock arriving",
        "Show something being cut, mixed, or made",
        "Film a regular saying hello",
        "Show the shelves fully stocked",
        "Film a before and after",
        "Show a staff member doing what they do best",
    ]

    /// Rotates on a slow clock rather than randomly, so two people looking at
    /// the station see the same prompt.
    static func current(at date: Date = Date()) -> String {
        let slot = Int(date.timeIntervalSince1970 / (60 * 20))
        return all[abs(slot) % all.count]
    }
}
