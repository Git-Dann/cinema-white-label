import Foundation

/// Data for a screening Live Activity and the "next ticket" widget. Pure models
/// and policy so the rules are unit-tested; ActivityKit/WidgetKit wrappers live
/// in the iOS-only CinemaActivities module.
///
/// Privacy: admission codes are never included. Lock Screen and widgets can be
/// seen by anyone holding the phone, so they show film, time, screen and seats
/// only, and deep-link to the ticket inside the app.

/// Fixed details of the screening (ActivityKit "attributes").
public struct ScreeningActivityContent: Codable, Hashable, Sendable {
    public var bookingId: String
    public var reference: String
    public var filmTitle: String
    public var certificate: String
    public var venueName: String
    public var auditoriumName: String
    public var seatSummary: String
    public var startsAt: Date
    public var endsAt: Date
    public var timeZone: String
    public var hasFood: Bool
    public var fulfilment: Fulfilment?
    /// Operator accent (dark appearance) so the activity matches the brand.
    public var accentHex: String
    public var wordmark: String
    public var deepLink: String

    public init(booking: Booking, config: TenantConfig) {
        bookingId = booking.id
        reference = booking.reference
        filmTitle = booking.film.title
        certificate = booking.film.certificate
        venueName = booking.venue.name
        auditoriumName = booking.auditorium.name
        seatSummary = booking.seatSummary
        startsAt = booking.screening.startsAt
        endsAt = booking.screening.endsAt
        timeZone = booking.venue.timeZone
        hasFood = !(booking.concessions ?? []).isEmpty
        fulfilment = booking.fulfilment
        accentHex = config.theme.dark.actionPrimary
        wordmark = config.branding.wordmark
        deepLink = "cinema-\(config.tenant.slug)://tickets"
    }
}

public enum ScreeningPhase: String, Codable, Hashable, Sendable, CaseIterable {
    /// More than 30 minutes before the start.
    case upcoming
    /// 30 to 10 minutes before: doors open, time to head in (and collect food).
    case doorsOpen
    /// Under 10 minutes to the start.
    case startingSoon
    /// Film running (adverts and trailers first, in most UK cinemas).
    case started
    /// After the scheduled end.
    case ended
}

/// Changing part of the activity (ActivityKit "content state").
public struct ScreeningActivityState: Codable, Hashable, Sendable {
    public var phase: ScreeningPhase
    public var headline: String
    public var detail: String

    public init(phase: ScreeningPhase, headline: String, detail: String) {
        self.phase = phase; self.headline = headline; self.detail = detail
    }
}

public enum LiveActivityPolicy {
    /// Start an activity at most this long before the screening. Live Activities
    /// stay active for up to 8 hours, so 4 hours leaves room for the film itself.
    public static let startWindow: TimeInterval = 4 * 3600
    public static let doorsOpenLead: TimeInterval = 30 * 60
    public static let startingSoonLead: TimeInterval = 10 * 60
    /// Keep the finished activity on the Lock Screen briefly, then dismiss.
    public static let dismissAfterEnd: TimeInterval = 15 * 60

    public static func phase(startsAt: Date, endsAt: Date, now: Date) -> ScreeningPhase {
        if now >= endsAt { return .ended }
        if now >= startsAt { return .started }
        let lead = startsAt.timeIntervalSince(now)
        if lead <= startingSoonLead { return .startingSoon }
        if lead <= doorsOpenLead { return .doorsOpen }
        return .upcoming
    }

    /// Whether to start an activity for this booking now. Demo builds may start
    /// earlier so the activity can be shown without waiting for a real showtime.
    public static func shouldStart(_ booking: Booking, now: Date, demo: Bool = false) -> Bool {
        guard booking.status == .CONFIRMED, booking.screening.endsAt > now else { return false }
        return demo || booking.screening.startsAt.timeIntervalSince(now) <= startWindow
    }

    public static func state(for content: ScreeningActivityContent, now: Date) -> ScreeningActivityState {
        let p = phase(startsAt: content.startsAt, endsAt: content.endsAt, now: now)
        let food = content.hasFood ? (content.fulfilment == .seatDelivery ? " Food will be brought to your seat." : " Collect your food at the counter.") : ""
        switch p {
        case .upcoming:
            return .init(phase: p, headline: content.filmTitle, detail: "\(content.auditoriumName) · Seats \(content.seatSummary)")
        case .doorsOpen:
            return .init(phase: p, headline: "Doors are open", detail: "\(content.auditoriumName) · Seats \(content.seatSummary).\(food)")
        case .startingSoon:
            return .init(phase: p, headline: "Starting soon", detail: "Head to \(content.auditoriumName), seats \(content.seatSummary).")
        case .started:
            return .init(phase: p, headline: "Enjoy the film", detail: "\(content.filmTitle) has started.")
        case .ended:
            return .init(phase: p, headline: "Thanks for visiting", detail: content.venueName)
        }
    }

    /// When the phase will next change, so the app can schedule a local update.
    public static func nextChange(startsAt: Date, endsAt: Date, now: Date) -> Date? {
        let boundaries = [startsAt.addingTimeInterval(-doorsOpenLead), startsAt.addingTimeInterval(-startingSoonLead), startsAt, endsAt]
        return boundaries.first { $0 > now }
    }

    /// The activity should be marked stale (and later dismissed) after the film ends.
    public static func staleDate(for content: ScreeningActivityContent) -> Date { content.endsAt }
    public static func dismissalDate(for content: ScreeningActivityContent) -> Date { content.endsAt.addingTimeInterval(dismissAfterEnd) }
}

// MARK: - Widget

/// What the widget shows. Written by the app to shared storage when available.
public struct WidgetSnapshot: Codable, Hashable, Sendable {
    public struct NextScreening: Codable, Hashable, Sendable {
        public var bookingId: String
        public var filmTitle: String
        public var certificate: String
        public var venueName: String
        public var auditoriumName: String
        public var seatSummary: String
        public var startsAt: Date
        public var timeZone: String

        public init(bookingId: String, filmTitle: String, certificate: String, venueName: String, auditoriumName: String, seatSummary: String, startsAt: Date, timeZone: String) {
            self.bookingId = bookingId; self.filmTitle = filmTitle; self.certificate = certificate; self.venueName = venueName
            self.auditoriumName = auditoriumName; self.seatSummary = seatSummary; self.startsAt = startsAt; self.timeZone = timeZone
        }
    }

    public var generatedAt: Date
    public var wordmark: String
    public var accentHex: String
    public var deepLink: String
    public var next: NextScreening?
    public var upcomingCount: Int
    /// True when the widget is showing sample data (demo builds, or no shared storage).
    public var isDemo: Bool

    public init(generatedAt: Date, wordmark: String, accentHex: String, deepLink: String, next: NextScreening?, upcomingCount: Int, isDemo: Bool) {
        self.generatedAt = generatedAt; self.wordmark = wordmark; self.accentHex = accentHex; self.deepLink = deepLink
        self.next = next; self.upcomingCount = upcomingCount; self.isDemo = isDemo
    }

    /// Nothing to show (e.g. no bundled config available).
    public static func empty(now: Date) -> WidgetSnapshot {
        WidgetSnapshot(generatedAt: now, wordmark: "Cinema", accentHex: "#2DD4BF", deepLink: "", next: nil, upcomingCount: 0, isDemo: true)
    }

    public static func make(bookings: [Booking], config: TenantConfig, now: Date) -> WidgetSnapshot {
        let upcoming = bookings.filter { $0.isUpcoming(now: now) }.sorted { $0.screening.startsAt < $1.screening.startsAt }
        let next = upcoming.first.map {
            NextScreening(bookingId: $0.id, filmTitle: $0.film.title, certificate: $0.film.certificate, venueName: $0.venue.name,
                          auditoriumName: $0.auditorium.name, seatSummary: $0.seatSummary, startsAt: $0.screening.startsAt, timeZone: $0.venue.timeZone)
        }
        return WidgetSnapshot(generatedAt: now, wordmark: config.branding.wordmark, accentHex: config.theme.dark.actionPrimary,
                              deepLink: "cinema-\(config.tenant.slug)://tickets", next: next, upcomingCount: upcoming.count, isDemo: false)
    }

    /// Sample content, clearly flagged, for demo builds and widget galleries.
    public static func demo(config: TenantConfig, now: Date) -> WidgetSnapshot {
        let start = now.addingTimeInterval(2 * 3600 + 15 * 60)
        return WidgetSnapshot(
            generatedAt: now, wordmark: config.branding.wordmark, accentHex: config.theme.dark.actionPrimary,
            deepLink: "cinema-\(config.tenant.slug)://tickets",
            next: .init(bookingId: "demo", filmTitle: "Ember Protocol", certificate: "12A", venueName: "\(config.branding.wordmark) Leeds Riverside",
                        auditoriumName: "Screen 2", seatSummary: "H8, H9", startsAt: start, timeZone: config.tenant.timeZone),
            upcomingCount: 1, isDemo: true)
    }

    /// Times at which the widget should refresh its text (phase boundaries).
    public func timelineDates(now: Date) -> [Date] {
        guard let next else { return [now] }
        let end = next.startsAt.addingTimeInterval(3 * 3600)
        return [now] + [next.startsAt.addingTimeInterval(-LiveActivityPolicy.doorsOpenLead), next.startsAt, end].filter { $0 > now }
    }
}

/// Shared storage between the app and its widget extension. Uses an App Group
/// when the build has one (paid developer accounts); otherwise unavailable and
/// the widget falls back to labelled demo content.
public struct WidgetSnapshotStore: Sendable {
    public static let key = "widgetSnapshot"
    public let suiteName: String

    public init(suiteName: String) { self.suiteName = suiteName }

    private var defaults: UserDefaults? {
        #if canImport(Darwin)
        // Without the App Group entitlement the shared container does not exist.
        guard FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: suiteName) != nil else { return nil }
        #endif
        return UserDefaults(suiteName: suiteName)
    }

    public var isAvailable: Bool { defaults != nil }

    @discardableResult
    public func save(_ snapshot: WidgetSnapshot) -> Bool {
        guard let defaults, let data = try? JSONEncoder().encode(snapshot) else { return false }
        defaults.set(data, forKey: Self.key)
        return true
    }

    public func load() -> WidgetSnapshot? {
        guard let data = defaults?.data(forKey: Self.key) else { return nil }
        return try? JSONDecoder().decode(WidgetSnapshot.self, from: data)
    }
}
