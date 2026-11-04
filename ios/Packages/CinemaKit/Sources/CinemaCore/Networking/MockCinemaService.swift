import Foundation

/// In-memory `CinemaService` for SwiftUI previews, UI tests without a backend,
/// and demos. It implements real hold, quote and booking behaviour against
/// fixture data so screens can be exercised end to end, but it is clearly a
/// mock: payments are always simulated and Wallet passes are never issued.
public actor MockCinemaService: CinemaService {
    public enum Failure: Sendable { case none, offline, seatsTaken }

    private var screenings: [String: ScreeningDetail] = [:]
    private var availabilityBySc: [String: [String: SeatAvailability]] = [:]
    private var holds: [String: SeatHold] = [:]
    private var booked: [Booking] = []
    private let config: TenantConfig
    public var failure: Failure = .none
    public var latency: Duration = .milliseconds(150)

    public init(config: TenantConfig = PreviewFixtures.config()) {
        self.config = config
        for (i, name) in PreviewFixtures.LayoutName.allCases.enumerated() {
            let s = PreviewFixtures.screening(name, start: Date().addingTimeInterval(Double(i + 1) * 3 * 3600))
            screenings[s.id] = s
            availabilityBySc[s.id] = PreviewFixtures.availability(for: s, seed: UInt64(i + 1)).seats
        }
    }

    public func setFailure(_ f: Failure) { failure = f }
    public func setLatency(_ d: Duration) { latency = d }

    private func simulateNetwork() async throws {
        try? await Task.sleep(for: latency)
        if failure == .offline { throw APIError(status: 0, code: .network, message: "You appear to be offline. Check your connection and try again.") }
    }

    public func fetchConfig(etag: String?) async throws -> (TenantConfig?, String?) { (config, "\"mock-\(config.version)\"") }
    public func films(status: Film.Status?, query: String?) async throws -> [Film] { try await simulateNetwork(); return [] }
    public func film(id: String) async throws -> Film { throw APIError(status: 404, code: .notFound, message: "Film not found") }
    public func venues(latitude: Double?, longitude: Double?, query: String?) async throws -> [Venue] { try await simulateNetwork(); return [] }
    public func setFavourite(venueId: String, _ favourite: Bool) async throws {}
    public func screeningDates(venueId: String, filmId: String?) async throws -> [String] { [] }
    public func screenings(venueId: String?, filmId: String?, date: String?) async throws -> [ScreeningSummary] { [] }

    public func screening(id: String) async throws -> ScreeningDetail {
        try await simulateNetwork()
        guard let s = screenings[id] ?? screenings.values.first else { throw APIError(status: 404, code: .notFound, message: "Screening not found") }
        return s
    }

    public func availability(screeningId: String) async throws -> AvailabilitySnapshot {
        try await simulateNetwork()
        expireHolds()
        let id = screenings[screeningId] == nil ? screenings.keys.sorted().first! : screeningId
        let mine = holds.values.first { $0.screeningId == id && $0.status == .ACTIVE }
        return AvailabilitySnapshot(screeningId: id, serverTime: Date(), version: holds.count + booked.count, seats: availabilityBySc[id] ?? [:],
                                    yourHold: mine.map { .init(id: $0.id, seatIds: $0.seatIds, expiresAt: $0.expiresAt) })
    }

    private func expireHolds() {
        for (id, h) in holds where h.status == .ACTIVE && h.expiresAt <= Date() {
            holds[id]?.status = .EXPIRED
            for seat in h.seatIds where availabilityBySc[h.screeningId]?[seat] == .held { availabilityBySc[h.screeningId]?[seat] = .available }
        }
    }

    public func createHold(screeningId: String, seatIds: [String], idempotencyKey: String) async throws -> SeatHold {
        try await simulateNetwork()
        if let existing = holds[idempotencyKey] { return existing }
        guard let s = screenings[screeningId] else { throw APIError(status: 404, code: .notFound, message: "Screening not found") }
        if failure == .seatsTaken, let first = seatIds.first {
            availabilityBySc[screeningId]?[first] = .sold
            throw APIError(status: 409, code: .seatsUnavailable, message: "Some seats are no longer available", seatIds: [first])
        }
        // Release this customer's previous hold, as the server does.
        for (id, h) in holds where h.screeningId == screeningId && h.status == .ACTIVE {
            holds[id]?.status = .RELEASED
            for seat in h.seatIds { availabilityBySc[screeningId]?[seat] = .available }
        }
        let taken = seatIds.filter { (availabilityBySc[screeningId]?[$0] ?? .available) != .available }
        if !taken.isEmpty { throw APIError(status: 409, code: .seatsUnavailable, message: "Some seats are no longer available", seatIds: taken) }
        let result = SeatRulesEngine(layout: s.layout, rules: s.seatRules ?? SeatRules()).evaluate(selected: seatIds, unavailable: [])
        if let e = result.errors.first {
            throw APIError(status: 422, code: .seatRules, message: e.message, seatIds: e.seatIds, violations: result.errors.map { RuleMessage(code: $0.code, message: $0.message, seatIds: $0.seatIds) })
        }
        for seat in seatIds { availabilityBySc[screeningId]?[seat] = .held }
        let hold = SeatHold(id: idempotencyKey, screeningId: screeningId, seatIds: seatIds, status: .ACTIVE, expiresAt: Date().addingTimeInterval(480), serverTime: Date(),
                            warnings: result.warnings.map { RuleMessage(code: $0.code, message: $0.message, seatIds: $0.seatIds) })
        holds[idempotencyKey] = hold
        return hold
    }

    public func releaseHold(id: String) async throws {
        guard let h = holds[id], h.status == .ACTIVE else { return }
        holds[id]?.status = .RELEASED
        for seat in h.seatIds { availabilityBySc[h.screeningId]?[seat] = .available }
    }

    public func concessions(venueId: String) async throws -> ConcessionMenu { try await simulateNetwork(); return PreviewFixtures.menu }

    public func quote(holdId: String, tickets: [TicketSelection], extras: BasketExtras) async throws -> Quote {
        try await simulateNetwork()
        guard let h = holds[holdId], let s = screenings[h.screeningId] else { throw APIError(status: 404, code: .notFound, message: "Reservation not found") }
        let seats = Dictionary(uniqueKeysWithValues: s.layout.seats.map { ($0.id, $0) })
        let rows = Dictionary(uniqueKeysWithValues: s.layout.rows.map { ($0.id, $0.label) })
        let lines: [Quote.Line] = try tickets.map { t in
            guard let seat = seats[t.seatId], let type = s.pricing.ticketTypes.first(where: { $0.id == t.ticketTypeId }),
                  let price = s.pricing.price(for: type, category: seat.priceCategory) else { throw APIError(status: 422, code: .validationFailed, message: "Invalid ticket") }
            return Quote.Line(seatId: seat.id, rowLabel: rows[seat.rowId] ?? "", seatLabel: seat.label, ticketTypeId: type.id, ticketTypeName: type.name, priceCategory: seat.priceCategory, baseMinor: price, supplementsMinor: 0, priceMinor: price)
        }
        let products = Dictionary(uniqueKeysWithValues: PreviewFixtures.menu.categories.flatMap(\.items).map { ($0.id, $0) })
        let food: [ConcessionLine] = try extras.concessions.map { item in
            guard let p = products[item.productId], p.isAvailable else { throw APIError(status: 422, code: .unknown, rawCode: "concession_unavailable", message: "Some items are no longer available") }
            if let problem = ModifierValidation.problems(product: p, modifiers: item.modifiers).first { throw APIError(status: 422, code: .validationFailed, message: "\(p.name): \(problem.lowercased())") }
            let unit = ModifierValidation.unitPrice(product: p, modifiers: item.modifiers)
            return ConcessionLine(productId: p.id, name: p.name, quantity: item.quantity, unitPriceMinor: unit, modifiers: [], lineTotalMinor: unit * item.quantity)
        }
        let sub = lines.reduce(0) { $0 + $1.priceMinor }
        let foodTotal = food.reduce(0) { $0 + $1.lineTotalMinor }
        let fees = s.pricing.bookingFeePerTicketMinor * lines.count
        var voucher: Quote.AppliedVoucher?
        if let code = extras.voucherCode?.uppercased(), !code.isEmpty {
            guard code == "WELCOME10" else { throw APIError(status: 422, code: .unknown, rawCode: "voucher_invalid", message: "This code is not recognised") }
            voucher = .init(code: code, description: "10% off your first booking", discountMinor: (sub + foodTotal) / 10)
        }
        let discount = voucher?.discountMinor ?? 0
        return Quote(currency: "GBP", lines: lines, subtotalMinor: sub, feesMinor: fees, discountMinor: discount, totalMinor: sub + foodTotal + fees - discount,
                     feeLabel: fees > 0 ? "Booking fee" : nil, concessions: food, concessionsMinor: foodTotal, voucher: voucher, fulfilment: extras.fulfilment)
    }

    public func checkout(holdId: String, tickets: [TicketSelection], extras: BasketExtras, simulateDecline: Bool, idempotencyKey: String) async throws -> Booking {
        if let existing = booked.first(where: { $0.id == "mock-\(holdId)" }) { return existing }
        if simulateDecline { throw APIError(status: 402, code: .paymentDeclined, message: "Your payment was declined") }
        let q = try await quote(holdId: holdId, tickets: tickets, extras: extras)
        guard let h = holds[holdId], let s = screenings[h.screeningId] else { throw APIError(status: 409, code: .holdNotActive, message: "This reservation is no longer active") }
        for seat in h.seatIds { availabilityBySc[h.screeningId]?[seat] = .sold }
        holds[holdId]?.status = .CONVERTED
        let ref = String(holdId.replacingOccurrences(of: "-", with: "").prefix(7)).uppercased()
        let booking = Booking(
            id: "mock-\(holdId)", reference: ref, status: .CONFIRMED, createdAt: Date(), confirmedAt: Date(),
            screening: .init(id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, localDate: s.localDate, formats: s.formats, attributes: s.attributes),
            film: .init(id: s.film.id, title: s.film.title, certificate: s.film.certificate, runtimeMinutes: s.film.runtimeMinutes, poster: nil, backdrop: nil),
            venue: .init(id: s.venue.id, name: s.venue.name, timeZone: s.venue.timeZone, address: .init(line1: "12 Wharf Approach", city: "Leeds", postcode: "LS1 4AB"), coordinate: .init(latitude: 53.79, longitude: -1.54)),
            auditorium: .init(id: s.auditorium.id, name: s.auditorium.name, screenNumber: s.auditorium.screenNumber),
            seats: q.lines.map { .init(seatId: $0.seatId, rowLabel: $0.rowLabel, seatLabel: $0.seatLabel, ticketTypeId: $0.ticketTypeId, priceMinor: $0.priceMinor) },
            totals: .init(currency: "GBP", subtotalMinor: q.subtotalMinor, feesMinor: q.feesMinor, discountMinor: q.discountMinor, totalMinor: q.totalMinor, concessionsMinor: q.concessionsMinor, voucherCode: q.voucher?.code),
            payment: .init(provider: "simulated", status: "CAPTURED", isSimulated: true),
            admission: .init(barcode: "MOCK.\(ref)", format: "qr"),
            wallet: .init(available: false, status: nil),
            concessions: (q.concessions ?? []).map { .init(name: $0.name, quantity: $0.quantity, modifiers: [], lineTotalMinor: $0.lineTotalMinor) },
            fulfilment: extras.fulfilment,
            cancellation: .init(cancelledAt: nil, cancellableUntil: s.startsAt.addingTimeInterval(-3600), canCancel: true, refundedMinor: 0)
        )
        booked.append(booking)
        return booking
    }

    public func bookings() async throws -> [Booking] { try await simulateNetwork(); return booked }

    public func cancelBooking(id: String) async throws -> Booking {
        try await simulateNetwork()
        guard let i = booked.firstIndex(where: { $0.id == id }) else { throw APIError(status: 404, code: .notFound, message: "Booking not found") }
        guard booked[i].cancellation?.canCancel == true else { throw APIError(status: 409, code: .unknown, rawCode: "cancellation_not_allowed", message: "This booking can no longer be cancelled") }
        var b = booked[i]
        b.status = .REFUNDED
        b.cancellation?.canCancel = false
        b.cancellation?.cancelledAt = Date()
        b.cancellation?.refundedMinor = b.totals.totalMinor
        booked[i] = b
        let screeningId = b.screening.id
        var seats = availabilityBySc[screeningId] ?? [:]
        for seat in b.seats { seats[seat.seatId] = .available }
        availabilityBySc[screeningId] = seats
        return b
    }

    public func requestWalletPass(bookingId: String) async throws -> WalletPassResponse {
        .demoUnsigned(serialNumber: bookingId, message: "Apple Wallet passes need a signed Pass Type ID certificate. This preview shows your ticket in the app instead.")
    }

    public func track(_ events: [AnalyticsEvent]) async throws {}
}
