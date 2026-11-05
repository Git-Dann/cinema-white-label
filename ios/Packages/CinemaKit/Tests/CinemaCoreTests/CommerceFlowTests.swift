import Foundation
import Testing
@testable import CinemaCore

@MainActor
@Suite("Food, vouchers and cancellation (mock service)")
struct CommerceFlowTests {
    func makeFlow(_ service: MockCinemaService) async throws -> BookingFlowModel {
        await service.setLatency(.zero)
        let s = try await service.screening(id: "preview-standard")
        let a = try await service.availability(screeningId: s.id)
        let sel = SeatSelectionModel(screening: s, availability: a, maxTickets: 10)
        return BookingFlowModel(service: service, selection: sel, formatters: Formatters())
    }

    func freeSeat(_ f: BookingFlowModel) -> String {
        f.selection.layout.seats.first { f.selection.presentation(for: $0).state == .available && $0.type == .standard && $0.restrictedView == nil
            && f.selection.rulesEngine.evaluate(selected: [$0.id], unavailable: f.selection.unavailableSeatIds).warnings.isEmpty }!.id
    }

    @Test func foodStepAppearsAndIsPricedIntoTheQuote() async throws {
        let svc = MockCinemaService()
        let f = try await makeFlow(svc)
        f.selection.toggle(freeSeat(f))
        await f.reserveSeats()
        #expect(f.offersFood)
        f.continueToReview()
        #expect(f.step == .food)
        let before = f.quote!.totalMinor
        await f.addToBasket(BasketItem(productId: "drink", modifiers: ["size": ["large"], "drink": ["cola"]]))
        await f.addToBasket(BasketItem(productId: "drink", modifiers: ["size": ["large"], "drink": ["cola"]]))
        #expect(f.basket.count == 1 && f.basket[0].quantity == 2)
        #expect(f.quote!.totalMinor == before + 2 * (450 + 135))
        #expect(f.offersSeatDelivery)
        f.continueToReview()
        #expect(f.step == .review)
        f.goBack()
        #expect(f.step == .food)
    }

    @Test func invalidModifierChoicesAreExplained() async throws {
        let svc = MockCinemaService()
        let f = try await makeFlow(svc)
        f.selection.toggle(freeSeat(f))
        await f.reserveSeats()
        f.continueToReview()
        await f.addToBasket(BasketItem(productId: "combo", modifiers: ["popcorn": ["sweet"], "drinks": ["cola"]]))
        #expect(f.basketMessage?.contains("choose 2 drinks") == true)
        #expect(ModifierValidation.problems(product: PreviewFixtures.menu.categories[2].items[0], modifiers: ["popcorn": ["sweet"], "drinks": ["cola", "water"]]).isEmpty)
    }

    @Test func vouchersApplyOrExplainWhyNot() async throws {
        let svc = MockCinemaService()
        let f = try await makeFlow(svc)
        f.selection.toggle(freeSeat(f))
        await f.reserveSeats()
        await f.applyVoucher("nope")
        #expect(f.voucherMessage == "This code is not recognised")
        #expect(f.voucherCode == nil)
        await f.applyVoucher("welcome10")
        #expect(f.quote?.voucher?.discountMinor == 125)
    }

    @Test func bookAndCancelWithinTheCutoff() async throws {
        let svc = MockCinemaService()
        let f = try await makeFlow(svc)
        let seat = freeSeat(f)
        f.selection.toggle(seat)
        await f.reserveSeats()
        f.continueToReview()
        f.continueToReview()
        await f.pay()
        let booking = try #require(f.booking)
        #expect(booking.cancellation?.canCancel == true)
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = TicketStore(cacheDirectory: dir, tenantSlug: "test")
        try await store.cancel(booking, using: svc)
        #expect(store.bookings.first?.status == .REFUNDED)
        let a = try await svc.availability(screeningId: booking.screening.id)
        #expect(a.seats[seat] == .available)
    }

    @Test func seatConflictFromServerIsRecoverable() async throws {
        let svc = MockCinemaService()
        let f = try await makeFlow(svc)
        let seat = freeSeat(f)
        f.selection.toggle(seat)
        await svc.setFailure(.seatsTaken)
        await f.reserveSeats()
        #expect(f.selection.conflicts == [seat])
        f.selection.removeConflicts()
        #expect(f.selection.selectedSeatIds.isEmpty)
    }

    @Test func analyticsOptOutStopsRecording() async {
        let provider = InMemoryAnalyticsProvider()
        let recorder = AnalyticsRecorder(providers: [provider])
        await recorder.record(.foodAdded, ["productId": "p"])
        await recorder.setEnabled(false)
        await recorder.record(.foodRemoved, ["productId": "p"])
        await recorder.flush()
        try? await Task.sleep(for: .milliseconds(50))
        let names = await provider.events.map(\.name)
        #expect(names == [])
    }
}

@Suite("Offline mock catalogue")
struct MockCatalogueTests {
    @Test func filmsShipWithLocalArtwork() {
        let films = PreviewFixtures.films
        #expect(films.count == 8)
        #expect(films.contains { $0.status == .comingSoon })
        let poster = films[0].poster!
        #expect(poster.url.hasPrefix("file:"))
        let url = poster.url(forPixelWidth: 300, base: URL(string: "http://localhost:3000/")!)!
        #expect(FileManager.default.fileExists(atPath: url.path))
    }

    @Test func showtimesAreGeneratedForEachFilmAndAreStable() async throws {
        let svc = MockCinemaService()
        await svc.setLatency(.zero)
        let film = PreviewFixtures.films.first { $0.status == .nowShowing }!
        let dates = try await svc.screeningDates(venueId: "leeds-riverside", filmId: film.id)
        #expect(dates.count == 5)
        let list = try await svc.screenings(venueId: "leeds-riverside", filmId: film.id, date: dates[0])
        #expect(list.count == 4)
        #expect(list.allSatisfy { $0.film.id == film.id })
        let detail = try await svc.screening(id: list[0].id)
        #expect(detail.film.title == film.title)
        let a1 = try await svc.availability(screeningId: detail.id)
        let a2 = try await MockCinemaService().availability(screeningId: detail.id)
        #expect(a1.seats == a2.seats) // deterministic across instances/launches
        let soon = PreviewFixtures.films.first { $0.status == .comingSoon }!
        #expect(try await svc.screeningDates(venueId: "leeds-riverside", filmId: soon.id).isEmpty)
    }
}
