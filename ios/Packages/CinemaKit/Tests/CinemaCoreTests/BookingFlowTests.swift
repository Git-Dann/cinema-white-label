import Foundation
import Testing
@testable import CinemaCore

/// In-memory CinemaService that records calls and can be scripted to fail.
final class FakeService: CinemaService, @unchecked Sendable {
    var holdKeys: [String] = []
    var checkoutKeys: [String] = []
    var holdError: APIError?
    var checkoutErrors: [APIError] = []
    var unknownCheckoutFailure = false
    var serverClockAhead: TimeInterval = 0
    var config: TenantConfig?

    func fetchConfig(etag: String?) async throws -> (TenantConfig?, String?) { (config, "\"v\"") }
    func films(status: Film.Status?, query: String?) async throws -> [Film] { [] }
    func film(id: String) async throws -> Film { throw APIError(status: 404, code: .notFound, message: "") }
    func venues(latitude: Double?, longitude: Double?, query: String?) async throws -> [Venue] { [] }
    func setFavourite(venueId: String, _ favourite: Bool) async throws {}
    func screeningDates(venueId: String, filmId: String?) async throws -> [String] { [] }
    func screenings(venueId: String?, filmId: String?, date: String?) async throws -> [ScreeningSummary] { [] }
    func screening(id: String) async throws -> ScreeningDetail { throw APIError(status: 404, code: .notFound, message: "") }
    func availability(screeningId: String) async throws -> AvailabilitySnapshot { Fixtures.snapshot(try Fixtures.layout("standard")) }
    func createHold(screeningId: String, seatIds: [String], idempotencyKey: String) async throws -> SeatHold {
        holdKeys.append(idempotencyKey)
        if let holdError { throw holdError }
        let now = Date().addingTimeInterval(serverClockAhead)
        return SeatHold(id: "hold_\(holdKeys.count)", screeningId: screeningId, seatIds: seatIds, status: .ACTIVE, expiresAt: now.addingTimeInterval(480), serverTime: now, warnings: [])
    }
    func releaseHold(id: String) async throws {}
    func concessions(venueId: String) async throws -> ConcessionMenu { ConcessionMenu(features: VenueFeatures(), categories: []) }
    func cancelBooking(id: String) async throws -> Booking { throw APIError(status: 404, code: .notFound, message: "") }
    func quote(holdId: String, tickets: [TicketSelection], extras: BasketExtras) async throws -> Quote {
        let lines = tickets.map { Quote.Line(seatId: $0.seatId, rowLabel: "F", seatLabel: "1", ticketTypeId: $0.ticketTypeId, ticketTypeName: "Adult", priceCategory: "standard", baseMinor: 1250, supplementsMinor: 0, priceMinor: $0.ticketTypeId == "child" ? 899 : 1250) }
        let sub = lines.map(\.priceMinor).reduce(0, +)
        return Quote(currency: "GBP", lines: lines, subtotalMinor: sub, feesMinor: 95 * lines.count, discountMinor: 0, totalMinor: sub + 95 * lines.count, feeLabel: "Booking fee")
    }
    func checkout(holdId: String, tickets: [TicketSelection], extras: BasketExtras, simulateDecline: Bool, idempotencyKey: String) async throws -> Booking {
        checkoutKeys.append(idempotencyKey)
        if unknownCheckoutFailure { unknownCheckoutFailure = false; throw URLError(.timedOut) }
        if !checkoutErrors.isEmpty { throw checkoutErrors.removeFirst() }
        let json = """
        {"id":"bk_1","reference":"ABC1234","status":"CONFIRMED","createdAt":"2026-11-04T22:00:00.000Z","confirmedAt":"2026-11-04T22:00:01.000Z",
         "screening":{"id":"scr_1","startsAt":"2027-01-15T19:30:00.000Z","endsAt":"2027-01-15T21:30:00.000Z","localDate":"2027-01-15","formats":["2D"],"attributes":[]},
         "film":{"id":"film_1","title":"The Lantern Keeper","certificate":"12A","runtimeMinutes":128,"poster":null,"backdrop":null},
         "venue":{"id":"v","name":"Northlight Leeds Riverside","timeZone":"Europe/London","address":{"line1":"12 Wharf Approach","city":"Leeds","postcode":"LS1 4AB"},"coordinate":{"latitude":53.79,"longitude":-1.54}},
         "auditorium":{"id":"a","name":"Screen 1","screenNumber":1},
         "seats":[{"seatId":"F-8","rowLabel":"F","seatLabel":"8","ticketTypeId":"adult","priceMinor":1250}],
         "totals":{"currency":"GBP","subtotalMinor":1250,"feesMinor":95,"discountMinor":0,"totalMinor":1345},
         "payment":{"provider":"simulated","status":"CAPTURED","isSimulated":true},
         "admission":{"barcode":"CIN1.ABC1234.bk_1.sig","format":"qr"},
         "wallet":{"available":false,"status":null}}
        """
        return try APIClient.decoder.decode(Booking.self, from: Data(json.utf8))
    }
    func bookings() async throws -> [Booking] { [] }
    func requestWalletPass(bookingId: String) async throws -> WalletPassResponse {
        try JSONDecoder().decode(WalletPassResponse.self, from: Data(#"{"status":"demo_unsigned","serialNumber":"s","message":"Needs a certificate","passJsonPreview":{}}"#.utf8))
    }
    func track(_ events: [AnalyticsEvent]) async throws {}
}

@MainActor
@Suite("Booking flow")
struct BookingFlowTests {
    let layout: AuditoriumLayout
    init() throws { layout = try Fixtures.layout("standard") }

    func flow(_ service: FakeService) -> BookingFlowModel {
        let sel = SeatSelectionModel(screening: Fixtures.screening(layout: layout), availability: Fixtures.snapshot(layout), maxTickets: 10)
        return BookingFlowModel(service: service, selection: sel, formatters: Formatters())
    }

    @Test func completesTheHappyPath() async {
        let svc = FakeService()
        let f = flow(svc)
        f.selection.toggle("F-8"); f.selection.toggle("F-9")
        await f.reserveSeats()
        #expect(f.step == .tickets)
        #expect(f.hold != nil)
        #expect(f.quote?.totalMinor == 1250 * 2 + 190)
        await f.setTicketType("child", for: "F-9")
        #expect(f.quote?.totalMinor == 1250 + 899 + 190)
        f.continueToReview()
        #expect(f.step == .review)
        await f.pay()
        #expect(f.step == .confirmed)
        #expect(f.booking?.payment?.isSimulated == true)
    }

    @Test func reusesTheHoldKeyForTheSameSeatsAndRotatesItWhenSeatsChange() async {
        let svc = FakeService()
        svc.holdError = APIError(status: 0, code: .network, message: "offline")
        let f = flow(svc)
        f.selection.toggle("F-8")
        await f.reserveSeats()
        await f.reserveSeats()
        #expect(svc.holdKeys.count == 2 && svc.holdKeys[0] == svc.holdKeys[1]) // safe retry
        f.selection.toggle("F-9")
        await f.reserveSeats()
        #expect(svc.holdKeys[2] != svc.holdKeys[1])
    }

    @Test func seatConflictMarksSeatsAndOffersRecovery() async {
        let svc = FakeService()
        svc.holdError = APIError(status: 409, code: .seatsUnavailable, message: "Some seats are no longer available", seatIds: ["F-9"])
        let f = flow(svc)
        f.selection.toggle("F-8"); f.selection.toggle("F-9")
        await f.reserveSeats()
        #expect(f.step == .seats)
        #expect(f.selection.conflicts == ["F-9"])
        guard case .failed(let failure) = f.phase else { Issue.record("expected failure"); return }
        #expect(failure.recovery == .chooseOtherSeats)
        #expect(failure.message.contains("F9"))
    }

    @Test func declineKeepsHoldAndUsesANewKeyForTheNextAttempt() async {
        let svc = FakeService()
        svc.checkoutErrors = [APIError(status: 402, code: .paymentDeclined, message: "Declined")]
        let f = flow(svc)
        f.selection.toggle("F-8")
        await f.reserveSeats()
        f.continueToReview()
        await f.pay(simulateDecline: true)
        guard case .failed(let failure) = f.phase else { Issue.record("expected decline"); return }
        #expect(failure.message.contains("still reserved"))
        #expect(f.hold != nil)
        await f.pay()
        #expect(f.step == .confirmed)
        #expect(svc.checkoutKeys.count == 2 && svc.checkoutKeys[0] != svc.checkoutKeys[1])
    }

    @Test func unknownOutcomeRetriesWithTheSameKey() async {
        let svc = FakeService()
        svc.unknownCheckoutFailure = true
        let f = flow(svc)
        f.selection.toggle("F-8")
        await f.reserveSeats()
        f.continueToReview()
        await f.pay()
        await f.pay()
        #expect(f.step == .confirmed)
        #expect(svc.checkoutKeys[0] == svc.checkoutKeys[1]) // never double-charges
    }

    @Test func expiredHoldSendsCustomerBackToSeats() async {
        let svc = FakeService()
        svc.checkoutErrors = [APIError(status: 410, code: .holdExpired, message: "Expired")]
        let f = flow(svc)
        f.selection.toggle("F-8")
        await f.reserveSeats()
        f.continueToReview()
        await f.pay()
        guard case .failed(let failure) = f.phase else { Issue.record("expected expiry"); return }
        #expect(failure.recovery == .startAgain)
        await f.recover()
        #expect(f.step == .seats)
        #expect(f.selection.selectedSeatIds == ["F-8"]) // selection preserved for convenience
    }

    @Test func countdownUsesServerClock() async {
        let svc = FakeService()
        svc.serverClockAhead = 120 // device clock is two minutes slow
        let f = flow(svc)
        f.selection.toggle("F-8")
        await f.reserveSeats()
        let remaining = f.secondsRemaining()!
        #expect((478...480).contains(remaining))
    }
}
