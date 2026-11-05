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

    // Loyalty and membership demo state. Starts with some points so redemption can be tried.
    private var points = 640
    private var ledger: [LoyaltySummary.Entry] = [
        .init(id: "seed-1", points: 640, reason: "earn", description: "Welcome bonus (demo)", balanceAfter: 640, createdAt: Date().addingTimeInterval(-86400 * 3)),
    ]
    private var membership: Membership?

    public func setFailure(_ f: Failure) { failure = f }
    public func setPoints(_ p: Int) { points = p }
    public func setLatency(_ d: Duration) { latency = d }

    private func simulateNetwork() async throws {
        try? await Task.sleep(for: latency)
        if failure == .offline { throw APIError(status: 0, code: .network, message: "You appear to be offline. Check your connection and try again.") }
    }

    public func fetchConfig(etag: String?) async throws -> (TenantConfig?, String?) { (config, "\"mock-\(config.version)\"") }
    private var favourites: Set<String> = ["leeds-riverside"]

    public func films(status: Film.Status?, query: String?) async throws -> [Film] {
        try await simulateNetwork()
        let q = query?.lowercased() ?? ""
        return PreviewFixtures.films.filter { (status == nil || $0.status == status) && (q.isEmpty || $0.title.lowercased().contains(q) || $0.cast.contains { $0.lowercased().contains(q) }) }
    }

    public func film(id: String) async throws -> Film {
        guard let f = PreviewFixtures.films.first(where: { $0.id == id || $0.slug == id }) else { throw APIError(status: 404, code: .notFound, message: "Film not found") }
        return f
    }

    public func venues(latitude: Double?, longitude: Double?, query: String?) async throws -> [Venue] {
        try await simulateNetwork()
        let q = query?.lowercased() ?? ""
        return PreviewFixtures.venues
            .filter { q.isEmpty || $0.name.lowercased().contains(q) || $0.address.city.lowercased().contains(q) || $0.address.postcode.lowercased().hasPrefix(q) }
            .map { var v = $0; v.isFavourite = favourites.contains(v.id); return v }
    }

    public func setFavourite(venueId: String, _ favourite: Bool) async throws {
        if favourite { favourites.insert(venueId) } else { favourites.remove(venueId) }
    }

    // Showtimes are generated on demand: id = "mock|film|layout|yyyy-MM-dd|HH:mm".
    private static let slots: [(String, PreviewFixtures.LayoutName)] = [("12:30", .standard), ("15:20", .curved), ("18:10", .premiere), ("20:50", .luxe)]

    private func dayString(_ offset: Int) -> String {
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Europe/London"); f.dateFormat = "yyyy-MM-dd"
        return f.string(from: Date().addingTimeInterval(Double(offset) * 86400))
    }

    public func screeningDates(venueId: String, filmId: String?) async throws -> [String] {
        if let filmId, PreviewFixtures.films.first(where: { $0.id == filmId })?.status == .comingSoon { return [] }
        return (1...5).map(dayString)
    }

    public func screenings(venueId: String?, filmId: String?, date: String?) async throws -> [ScreeningSummary] {
        try await simulateNetwork()
        let films = PreviewFixtures.films.filter { $0.status == .nowShowing && (filmId == nil || $0.id == filmId) }
        let days = date.map { [$0] } ?? (1...3).map(dayString)
        var out: [ScreeningSummary] = []
        for day in days {
            for (i, film) in films.prefix(filmId == nil ? 3 : 1).enumerated() {
                for (j, slot) in Self.slots.enumerated() where filmId != nil || (i + j) % 2 == 0 {
                    let d = try detail(id: "mock|\(film.id)|\(slot.1.rawValue)|\(day)|\(slot.0)")
                    out.append(ScreeningSummary(id: d.id, startsAt: d.startsAt, endsAt: d.endsAt, localDate: d.localDate, formats: d.formats, attributes: [], onSale: true,
                                                availability: d.availability, film: d.film, venue: d.venue, auditorium: d.auditorium))
                }
            }
        }
        return out.sorted { $0.startsAt < $1.startsAt }
    }

    private func detail(id: String) throws -> ScreeningDetail {
        if let s = screenings[id] { return s }
        let parts = id.split(separator: "|").map(String.init)
        guard parts.count == 5, parts[0] == "mock", let film = PreviewFixtures.films.first(where: { $0.id == parts[1] }),
              let layout = PreviewFixtures.LayoutName(rawValue: parts[2]) else { throw APIError(status: 404, code: .notFound, message: "Screening not found") }
        let f = DateFormatter(); f.locale = Locale(identifier: "en_US_POSIX"); f.timeZone = TimeZone(identifier: "Europe/London"); f.dateFormat = "yyyy-MM-dd HH:mm"
        let start = f.date(from: "\(parts[3]) \(parts[4])") ?? Date().addingTimeInterval(86400)
        var s = PreviewFixtures.screening(layout, id: id, start: start)
        s.film = .init(id: film.id, title: film.title, certificate: film.certificate, runtimeMinutes: film.runtimeMinutes, poster: film.poster)
        s.localDate = parts[3]
        s.endsAt = start.addingTimeInterval(Double(film.runtimeMinutes + 20) * 60)
        let seats = PreviewFixtures.availability(for: s, seed: id.unicodeScalars.reduce(UInt64(7)) { ($0 &* 31) &+ UInt64($1.value) }).seats
        let free = seats.values.filter { $0 == .available }.count
        s.availability = .init(available: free, total: seats.count, level: free == 0 ? .soldOut : Double(free) / Double(seats.count) < 0.2 ? .limited : .good)
        screenings[id] = s
        availabilityBySc[id] = seats
        return s
    }

    public func screening(id: String) async throws -> ScreeningDetail {
        try await simulateNetwork()
        if screenings[id] == nil, !id.hasPrefix("mock|"), let first = screenings.values.first { return first }
        return try detail(id: id)
    }

    public func availability(screeningId: String) async throws -> AvailabilitySnapshot {
        try await simulateNetwork()
        expireHolds()
        if screenings[screeningId] == nil { _ = try? detail(id: screeningId) }
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

    public func promotions(venueId: String?) async throws -> [Promotion] { try await simulateNetwork(); return PreviewFixtures.promotions }

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
        // Same order as the server: membership, voucher, points. Fees are never paid with points.
        let ent = activeMembership?.plan.entitlements
        let memberTickets = sub * (ent?.ticketDiscountPercent ?? 0) / 100
        let memberFood = foodTotal * (ent?.foodDiscountPercent ?? 0) / 100
        let feeWaived = ent?.bookingFeeWaived == true ? fees : 0
        let payableFees = fees - feeWaived
        if voucher != nil { voucher?.discountMinor = (sub - memberTickets + foodTotal - memberFood) / 10 }
        let goods = sub + foodTotal - memberTickets - memberFood - (voucher?.discountMinor ?? 0)
        let program = PreviewFixtures.loyaltyProgram
        let step = program.redeemPointsPerPound
        if extras.loyaltyPoints > 0 {
            if extras.loyaltyPoints % step != 0 { throw pointsError("Points are used in steps of \(step) (£1 each)") }
            if extras.loyaltyPoints > points { throw pointsError("You have \(points) points") }
            if extras.loyaltyPoints / step * 100 > goods { throw pointsError("That is more points than this order needs") }
        }
        let pointsDiscount = extras.loyaltyPoints / step * 100
        let maxPoints = min(points, goods / 100 * step) / step * step
        let earn = Int(Double((goods - pointsDiscount) * program.earnPointsPerPound) * (ent?.pointsMultiplier ?? 1) / 100)
        var discounts: [Quote.Discount] = []
        if memberTickets + memberFood > 0, let m = activeMembership { discounts.append(.init(kind: "membership", label: "\(m.plan.name) member discount", amountMinor: memberTickets + memberFood)) }
        if let v = voucher { discounts.append(.init(kind: "voucher", label: v.description, amountMinor: v.discountMinor)) }
        if pointsDiscount > 0 { discounts.append(.init(kind: "points", label: "\(extras.loyaltyPoints) points", amountMinor: pointsDiscount)) }
        let discount = discounts.reduce(0) { $0 + $1.amountMinor }
        return Quote(currency: "GBP", lines: lines, subtotalMinor: sub, feesMinor: payableFees, discountMinor: discount, totalMinor: sub + foodTotal + payableFees - discount,
                     feeLabel: payableFees > 0 ? "Booking fee" : nil, concessions: food, concessionsMinor: foodTotal, voucher: voucher, fulfilment: extras.fulfilment,
                     discounts: discounts,
                     membership: activeMembership.map { .init(planName: $0.plan.name, discountMinor: memberTickets + memberFood, feeWaivedMinor: feeWaived) },
                     loyalty: .init(name: program.name, earnPointsPerPound: program.earnPointsPerPound, redeemPointsPerPound: step, minRedeemPoints: program.minRedeemPoints,
                                    balance: points, pointsRedeemed: extras.loyaltyPoints, pointsDiscountMinor: pointsDiscount, pointsToEarn: earn,
                                    maxRedeemablePoints: maxPoints >= max(step, program.minRedeemPoints) ? maxPoints : 0))
    }

    private func pointsError(_ message: String) -> APIError { APIError(status: 422, code: .unknown, rawCode: "points_invalid", message: message) }

    private var activeMembership: Membership? {
        guard let m = membership, m.currentPeriodEnd > Date() else { return nil }
        return m
    }

    public func loyalty() async throws -> LoyaltySummary {
        try await simulateNetwork()
        let program = PreviewFixtures.loyaltyProgram
        return LoyaltySummary(program: program, points: points, valueMinor: points / program.redeemPointsPerPound * 100, history: ledger.reversed())
    }

    public func membershipPlans() async throws -> [MembershipPlan] { try await simulateNetwork(); return PreviewFixtures.membershipPlans }

    public func myMembership() async throws -> Membership? {
        try await simulateNetwork()
        guard var m = membership else { return nil }
        m.status = m.currentPeriodEnd > Date() ? "active" : "expired"
        return m
    }

    public func purchaseMembership(planId: String, simulateDecline: Bool, idempotencyKey: String) async throws -> Membership {
        try await simulateNetwork()
        guard let plan = PreviewFixtures.membershipPlans.first(where: { $0.id == planId }) else { throw APIError(status: 404, code: .notFound, message: "Membership plan not found") }
        if simulateDecline { throw APIError(status: 402, code: .paymentDeclined, message: "Your payment was declined") }
        let now = Date()
        if let m = activeMembership, m.plan.id != plan.id {
            throw APIError(status: 409, code: .unknown, rawCode: "membership_not_allowed", message: "You're a \(m.plan.name) member until then. You can change plan after that.")
        }
        let start = activeMembership?.currentPeriodEnd ?? now
        let end = Calendar(identifier: .gregorian).date(byAdding: plan.interval == "year" ? .year : .month, value: 1, to: start) ?? start
        membership = Membership(plan: plan, status: "active", startedAt: activeMembership?.startedAt ?? now, currentPeriodEnd: end)
        return membership!
    }

    public func checkout(holdId: String, tickets: [TicketSelection], extras: BasketExtras, simulateDecline: Bool, idempotencyKey: String) async throws -> Booking {
        if let existing = booked.first(where: { $0.id == "mock-\(holdId)" }) { return existing }
        if simulateDecline { throw APIError(status: 402, code: .paymentDeclined, message: "Your payment was declined") }
        let q = try await quote(holdId: holdId, tickets: tickets, extras: extras)
        guard let h = holds[holdId], let s = screenings[h.screeningId] else { throw APIError(status: 409, code: .holdNotActive, message: "This reservation is no longer active") }
        for seat in h.seatIds { availabilityBySc[h.screeningId]?[seat] = .sold }
        holds[holdId]?.status = .CONVERTED
        let redeemed = q.loyalty?.pointsRedeemed ?? 0
        let earned = q.loyalty?.pointsToEarn ?? 0
        if redeemed > 0 {
            points -= redeemed
            ledger.append(.init(id: "\(holdId)-redeem", points: -redeemed, reason: "redeem", description: s.film.title, balanceAfter: points, bookingId: "mock-\(holdId)", createdAt: Date()))
        }
        if earned > 0 {
            points += earned
            ledger.append(.init(id: "\(holdId)-earn", points: earned, reason: "earn", description: s.film.title, balanceAfter: points, bookingId: "mock-\(holdId)", createdAt: Date()))
        }
        let ref = String(holdId.replacingOccurrences(of: "-", with: "").prefix(7)).uppercased()
        let booking = Booking(
            id: "mock-\(holdId)", reference: ref, status: .CONFIRMED, createdAt: Date(), confirmedAt: Date(),
            screening: .init(id: s.id, startsAt: s.startsAt, endsAt: s.endsAt, localDate: s.localDate, formats: s.formats, attributes: s.attributes),
            film: .init(id: s.film.id, title: s.film.title, certificate: s.film.certificate, runtimeMinutes: s.film.runtimeMinutes,
                        poster: PreviewFixtures.films.first { $0.id == s.film.id }?.poster ?? s.film.poster,
                        backdrop: PreviewFixtures.films.first { $0.id == s.film.id }?.backdrop),
            venue: .init(id: s.venue.id, name: s.venue.name, timeZone: s.venue.timeZone, address: .init(line1: "12 Wharf Approach", city: "Leeds", postcode: "LS1 4AB"), coordinate: .init(latitude: 53.79, longitude: -1.54)),
            auditorium: .init(id: s.auditorium.id, name: s.auditorium.name, screenNumber: s.auditorium.screenNumber),
            seats: q.lines.map { .init(seatId: $0.seatId, rowLabel: $0.rowLabel, seatLabel: $0.seatLabel, ticketTypeId: $0.ticketTypeId, priceMinor: $0.priceMinor) },
            totals: .init(currency: "GBP", subtotalMinor: q.subtotalMinor, feesMinor: q.feesMinor, discountMinor: q.discountMinor, totalMinor: q.totalMinor, concessionsMinor: q.concessionsMinor, voucherCode: q.voucher?.code,
                          membershipDiscountMinor: q.membership?.discountMinor, membershipPlanName: q.membership?.planName,
                          pointsRedeemed: redeemed, pointsDiscountMinor: q.loyalty?.pointsDiscountMinor, pointsEarned: earned),
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
        if let r = b.totals.pointsRedeemed, r > 0 {
            points += r
            ledger.append(.init(id: "\(id)-refund", points: r, reason: "refund_redeem", description: "Cancelled booking \(b.reference)", balanceAfter: points, bookingId: id, createdAt: Date()))
        }
        if let e = b.totals.pointsEarned, e > 0 {
            let back = min(e, points)
            points -= back
            if back > 0 { ledger.append(.init(id: "\(id)-reverse", points: -back, reason: "reverse_earn", description: "Cancelled booking \(b.reference)", balanceAfter: points, bookingId: id, createdAt: Date())) }
        }
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
