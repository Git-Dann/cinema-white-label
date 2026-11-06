import Foundation

/// Locale-aware formatting. Prices are integer minor units; screening times are
/// always shown in the cinema's time zone, not the device's.
public struct Formatters: Sendable {
    public let locale: Locale
    public let currencyCode: String

    public init(locale: Locale = Locale(identifier: "en_GB"), currencyCode: String = "GBP") {
        self.locale = locale
        self.currencyCode = currencyCode
    }

    public func money(_ minor: Int) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.locale = locale
        f.currencyCode = currencyCode
        return f.string(from: NSNumber(value: Double(minor) / 100)) ?? "\(minor)"
    }

    public func time(_ date: Date, timeZone: String) -> String {
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = TimeZone(identifier: timeZone)
        f.dateFormat = "HH:mm"
        return f.string(from: date)
    }

    /// "Thu 5 Nov"
    public func shortDate(_ date: Date, timeZone: String) -> String {
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = TimeZone(identifier: timeZone)
        f.setLocalizedDateFormatFromTemplate("EEE d MMM")
        return f.string(from: date)
    }

    /// "Thursday 5 November"
    /// "Fri 7 Nov, 19:30" in the venue's time zone.
    public func dayAndTime(_ date: Date, timeZone: String) -> String {
        "\(shortDate(date, timeZone: timeZone)), \(time(date, timeZone: timeZone))"
    }

    public func longDate(_ date: Date, timeZone: String) -> String {
        let f = DateFormatter()
        f.locale = locale
        f.timeZone = TimeZone(identifier: timeZone)
        f.setLocalizedDateFormatFromTemplate("EEEE d MMMM")
        return f.string(from: date)
    }

    /// Converts a YYYY-MM-DD local date to a Date at local noon (safe for display).
    public func date(fromLocal day: String, timeZone: String) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = TimeZone(identifier: timeZone)
        f.dateFormat = "yyyy-MM-dd HH:mm"
        return f.date(from: "\(day) 12:00")
    }

    public func runtime(_ minutes: Int) -> String {
        let h = minutes / 60, m = minutes % 60
        return h > 0 ? (m > 0 ? "\(h)h \(m)m" : "\(h)h") : "\(m)m"
    }

    /// VoiceOver-friendly runtime: "2 hours 15 minutes".
    public func spokenRuntime(_ minutes: Int) -> String {
        let h = minutes / 60, m = minutes % 60
        let hours = h == 1 ? "1 hour" : "\(h) hours"
        let mins = m == 1 ? "1 minute" : "\(m) minutes"
        if h == 0 { return mins }
        return m == 0 ? hours : "\(hours) \(mins)"
    }

    /// "7:42" countdown for hold expiry.
    public func countdown(_ seconds: Int) -> String {
        let s = max(0, seconds)
        return String(format: "%d:%02d", s / 60, s % 60)
    }
}
