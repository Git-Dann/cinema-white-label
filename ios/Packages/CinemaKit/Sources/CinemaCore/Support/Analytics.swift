import Foundation

/// Event names are an allow-list shared with the backend. Properties carry
/// identifiers only, never personal data (UK GDPR data minimisation).
public enum AnalyticsEventName: String, Codable, Sendable {
    case appOpened = "app_opened"
    case cinemaSelected = "cinema_selected"
    case cinemaFavourited = "cinema_favourited"
    case filmViewed = "film_viewed"
    case screeningViewed = "screening_viewed"
    case seatSelectorOpened = "seat_selector_opened"
    case seatSelected = "seat_selected"
    case seatChanged = "seat_changed"
    case seatHoldFailed = "seat_hold_failed"
    case bookingAbandoned = "booking_abandoned"
    case checkoutStarted = "checkout_started"
    case paymentCompleted = "payment_completed"
    case bookingConfirmed = "booking_confirmed"
    case walletPassRequested = "wallet_pass_requested"
    case walletPassIssued = "wallet_pass_issued"
    case themeLoadFailed = "theme_load_failed"
    case filmImpression = "film_impression"
    case screeningSelected = "screening_selected"
    case seatMapZoomed = "seat_map_zoomed"
    case ticketTypeChanged = "ticket_type_changed"
    case foodAdded = "food_added"
    case foodRemoved = "food_removed"
    case voucherApplied = "voucher_applied"
    case checkoutFailed = "checkout_failed"
    case bookingCancelled = "booking_cancelled"
    case ticketsRefreshFailed = "tickets_refresh_failed"
    case membershipViewed = "membership_viewed"
    case membershipEngaged = "membership_engaged"
}

/// Destination for analytics events. The platform backend is the default; an
/// operator can add its own provider (e.g. a consented third-party SDK) without
/// touching feature code.
public protocol AnalyticsProvider: Sendable {
    func send(_ events: [AnalyticsEvent]) async
}

public struct BackendAnalyticsProvider: AnalyticsProvider {
    let service: any CinemaService
    public init(service: any CinemaService) { self.service = service }
    public func send(_ events: [AnalyticsEvent]) async { try? await service.track(events) }
}

/// Collects events in memory; used by tests and debug builds.
public actor InMemoryAnalyticsProvider: AnalyticsProvider {
    public private(set) var events: [AnalyticsEvent] = []
    public init() {}
    public func send(_ events: [AnalyticsEvent]) async { self.events += events }
}

public struct AnalyticsEvent: Codable, Sendable, Hashable {
    public var name: AnalyticsEventName
    public var occurredAt: String
    public var sessionId: String?
    public var properties: [String: String]

    public init(_ name: AnalyticsEventName, at date: Date = Date(), sessionId: String? = nil, properties: [String: String] = [:]) {
        self.name = name
        self.occurredAt = ISO8601DateFormatter().string(from: date)
        self.sessionId = sessionId
        self.properties = properties
    }
}

/// Buffers events and sends them in batches. Failures are dropped silently:
/// analytics must never affect the booking experience.
public actor AnalyticsRecorder {
    private let providers: [any AnalyticsProvider]
    /// Customers can opt out in Account; nothing is recorded while disabled.
    public var isEnabled = true
    private let sessionId = UUID().uuidString
    private var buffer: [AnalyticsEvent] = []
    private var flushTask: Task<Void, Never>?

    public init(service: any CinemaService) { self.providers = [BackendAnalyticsProvider(service: service)] }
    public init(providers: [any AnalyticsProvider]) { self.providers = providers }

    public func setEnabled(_ enabled: Bool) { isEnabled = enabled; if !enabled { buffer = [] } }

    public func record(_ name: AnalyticsEventName, _ properties: [String: String] = [:]) {
        guard isEnabled else { return }
        buffer.append(AnalyticsEvent(name, sessionId: sessionId, properties: properties))
        if buffer.count >= 20 { flush() } else if flushTask == nil {
            flushTask = Task { [weak self] in
                try? await Task.sleep(for: .seconds(10))
                await self?.flush()
            }
        }
    }

    public func flush() {
        flushTask?.cancel(); flushTask = nil
        guard !buffer.isEmpty else { return }
        let batch = buffer; buffer = []
        let providers = self.providers
        Task { for p in providers { await p.send(batch) } }
    }
}
