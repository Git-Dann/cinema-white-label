import Foundation

/// The app's view of the platform API. Feature models depend on this protocol
/// so they can be tested with an in-memory fake.
public protocol CinemaService: Sendable {
    func fetchConfig(etag: String?) async throws -> (TenantConfig?, String?)
    func films(status: Film.Status?, query: String?) async throws -> [Film]
    func film(id: String) async throws -> Film
    func venues(latitude: Double?, longitude: Double?, query: String?) async throws -> [Venue]
    func setFavourite(venueId: String, _ favourite: Bool) async throws
    func screeningDates(venueId: String, filmId: String?) async throws -> [String]
    func screenings(venueId: String?, filmId: String?, date: String?) async throws -> [ScreeningSummary]
    func screening(id: String) async throws -> ScreeningDetail
    func availability(screeningId: String) async throws -> AvailabilitySnapshot
    func createHold(screeningId: String, seatIds: [String], idempotencyKey: String) async throws -> SeatHold
    func releaseHold(id: String) async throws
    func quote(holdId: String, tickets: [TicketSelection]) async throws -> Quote
    func checkout(holdId: String, tickets: [TicketSelection], simulateDecline: Bool, idempotencyKey: String) async throws -> Booking
    func bookings() async throws -> [Booking]
    func requestWalletPass(bookingId: String) async throws -> WalletPassResponse
    func track(_ events: [AnalyticsEvent]) async throws
}

public struct LiveCinemaService: CinemaService {
    public let client: APIClient
    public init(client: APIClient) { self.client = client }

    private func q(_ items: [String: String?]) -> String {
        var c = URLComponents()
        c.queryItems = items.compactMap { k, v in v.map { URLQueryItem(name: k, value: $0) } }.sorted { $0.name < $1.name }
        let s = c.percentEncodedQuery ?? ""
        return s.isEmpty ? "" : "?\(s)"
    }

    public func fetchConfig(etag: String?) async throws -> (TenantConfig?, String?) {
        let r = try await client.send("GET", "/config", ifNoneMatch: etag, as: TenantConfig.self)
        return (r.value, r.etag)
    }

    public func films(status: Film.Status?, query: String?) async throws -> [Film] {
        try await client.get("/films" + q(["status": status?.rawValue, "q": query]))
    }

    public func film(id: String) async throws -> Film { try await client.get("/films/\(id)") }

    public func venues(latitude: Double?, longitude: Double?, query: String?) async throws -> [Venue] {
        try await client.get("/venues" + q(["lat": latitude.map { String($0) }, "lng": longitude.map { String($0) }, "q": query]), authenticated: true)
    }

    public func setFavourite(venueId: String, _ favourite: Bool) async throws {
        _ = try await client.send(favourite ? "PUT" : "DELETE", "/me/favourites/\(venueId)", authenticated: true, as: EmptyResponse.self)
    }

    public func screeningDates(venueId: String, filmId: String?) async throws -> [String] {
        try await client.get("/venues/\(venueId)/dates" + q(["filmId": filmId]))
    }

    public func screenings(venueId: String?, filmId: String?, date: String?) async throws -> [ScreeningSummary] {
        try await client.get("/screenings" + q(["venueId": venueId, "filmId": filmId, "date": date, "days": date == nil ? "7" : nil]))
    }

    public func screening(id: String) async throws -> ScreeningDetail { try await client.get("/screenings/\(id)") }

    public func availability(screeningId: String) async throws -> AvailabilitySnapshot {
        try await client.get("/screenings/\(screeningId)/availability", authenticated: true)
    }

    public func createHold(screeningId: String, seatIds: [String], idempotencyKey: String) async throws -> SeatHold {
        struct Body: Encodable, Sendable { var screeningId: String; var seatIds: [String] }
        return try await client.send("POST", "/holds", body: Body(screeningId: screeningId, seatIds: seatIds), authenticated: true, idempotencyKey: idempotencyKey, as: SeatHold.self).value!
    }

    public func releaseHold(id: String) async throws {
        _ = try await client.send("DELETE", "/holds/\(id)", authenticated: true, as: EmptyResponse.self)
    }

    public func quote(holdId: String, tickets: [TicketSelection]) async throws -> Quote {
        struct Body: Encodable, Sendable { var holdId: String; var tickets: [TicketSelection] }
        return try await client.send("POST", "/quotes", body: Body(holdId: holdId, tickets: tickets), authenticated: true, as: Quote.self).value!
    }

    public func checkout(holdId: String, tickets: [TicketSelection], simulateDecline: Bool, idempotencyKey: String) async throws -> Booking {
        struct Payment: Encodable, Sendable { var type = "simulated"; var outcome: String }
        struct Body: Encodable, Sendable { var holdId: String; var tickets: [TicketSelection]; var payment: Payment }
        let body = Body(holdId: holdId, tickets: tickets, payment: Payment(outcome: simulateDecline ? "decline" : "approve"))
        return try await client.send("POST", "/checkout", body: body, authenticated: true, idempotencyKey: idempotencyKey, as: Booking.self).value!
    }

    public func bookings() async throws -> [Booking] { try await client.get("/me/bookings", authenticated: true) }

    public func requestWalletPass(bookingId: String) async throws -> WalletPassResponse {
        try await client.send("POST", "/bookings/\(bookingId)/wallet-pass", body: EmptyResponse(), authenticated: true, as: WalletPassResponse.self).value!
    }

    public func track(_ events: [AnalyticsEvent]) async throws {
        struct Body: Encodable, Sendable { var events: [AnalyticsEvent] }
        _ = try await client.send("POST", "/analytics/events", body: Body(events: events), as: EmptyResponse.self)
    }
}

/// Guest session tokens. Persistence is injected so iOS stores them in the Keychain.
public actor GuestTokenProvider: TokenProvider {
    public protocol Store: Sendable {
        func load() -> String?
        func save(_ token: String?)
    }

    private let baseURL: URL
    private let tenantSlug: String
    private let store: any Store
    private var cached: String?
    private var inFlight: Task<String, any Error>?

    public init(baseURL: URL, tenantSlug: String, store: any Store) {
        self.baseURL = baseURL; self.tenantSlug = tenantSlug; self.store = store
        self.cached = store.load()
    }

    public func token() async throws -> String {
        if let cached { return cached }
        if let inFlight { return try await inFlight.value }
        let client = APIClient(baseURL: baseURL, tenantSlug: tenantSlug)
        let task = Task { () throws -> String in
            let session = try await client.send("POST", "/auth/guest", body: EmptyResponse(), as: GuestSession.self).value!
            return session.token
        }
        inFlight = task
        defer { inFlight = nil }
        let token = try await task.value
        cached = token
        store.save(token)
        return token
    }

    public func invalidate() async {
        cached = nil
        store.save(nil)
    }
}

/// Non-persistent store for tests and previews.
public final class InMemoryTokenStore: GuestTokenProvider.Store, @unchecked Sendable {
    private var value: String?
    private let lock = NSLock()
    public init(_ value: String? = nil) { self.value = value }
    public func load() -> String? { lock.lock(); defer { lock.unlock() }; return value }
    public func save(_ token: String?) { lock.lock(); value = token; lock.unlock() }
}
