import Foundation

/// One day's opening window in shop local time, 24 hour "HH:MM" strings.
struct DayHours: Codable, Equatable {
    var open: String
    var close: String
}

/// Weekly hours keyed by `mon tue wed thu fri sat sun`. A missing or null day
/// means closed.
struct WeeklyHours: Codable, Equatable {
    var days: [String: DayHours?]

    static let keys = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

    init(days: [String: DayHours?]) {
        self.days = days
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        days = (try? container.decode([String: DayHours?].self)) ?? [:]
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        try container.encode(days)
    }

    /// Mon to Sat 09:00 to 19:00, Sunday closed.
    static let fallback = WeeklyHours(days: [
        "mon": DayHours(open: "09:00", close: "19:00"),
        "tue": DayHours(open: "09:00", close: "19:00"),
        "wed": DayHours(open: "09:00", close: "19:00"),
        "thu": DayHours(open: "09:00", close: "19:00"),
        "fri": DayHours(open: "09:00", close: "19:00"),
        "sat": DayHours(open: "09:00", close: "19:00"),
        "sun": nil,
    ])

    func hours(forWeekday weekday: Int) -> DayHours? {
        // Calendar weekday: 1 is Sunday.
        let key = WeeklyHours.keys[max(0, min(6, weekday - 1))]
        return days[key] ?? nil
    }
}

/// Evaluates weekly hours in the shop timezone.
struct HoursEvaluator {
    struct Result: Equatable {
        var isOpen: Bool
        /// Next time the shop opens, nil when no open window exists at all.
        var nextOpen: Date?
        /// When open, the time the current window closes.
        var closesAt: Date?
    }

    let hours: WeeklyHours
    let timeZone: TimeZone

    init(hours: WeeklyHours?, timeZoneIdentifier: String?) {
        self.hours = hours ?? .fallback
        self.timeZone = TimeZone(identifier: timeZoneIdentifier ?? "") ?? .current
    }

    func evaluate(at now: Date) -> Result {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone

        // Look at yesterday, today, and the next seven days so overnight
        // windows and closed streaks resolve.
        var windows: [(open: Date, close: Date)] = []
        for offset in -1...7 {
            guard let day = calendar.date(byAdding: .day, value: offset, to: now) else { continue }
            let weekday = calendar.component(.weekday, from: day)
            guard let dayHours = hours.hours(forWeekday: weekday) else { continue }
            guard let open = HoursEvaluator.date(on: day, clock: dayHours.open, calendar: calendar),
                  var close = HoursEvaluator.date(on: day, clock: dayHours.close, calendar: calendar) else { continue }
            if close <= open, let next = calendar.date(byAdding: .day, value: 1, to: close) {
                close = next
            }
            windows.append((open, close))
        }
        windows.sort { $0.open < $1.open }

        if let current = windows.first(where: { $0.open <= now && now < $0.close }) {
            return Result(isOpen: true, nextOpen: nil, closesAt: current.close)
        }
        let next = windows.first(where: { $0.open > now })?.open
        return Result(isOpen: false, nextOpen: next, closesAt: nil)
    }

    private static func date(on day: Date, clock: String, calendar: Calendar) -> Date? {
        let parts = clock.split(separator: ":").compactMap { Int($0) }
        guard parts.count >= 2 else { return nil }
        var components = calendar.dateComponents([.year, .month, .day], from: day)
        components.hour = parts[0]
        components.minute = parts[1]
        components.second = 0
        return calendar.date(from: components)
    }
}
