import Foundation
import Testing
@testable import CinemaCore

@MainActor
@Suite("Food tab: specials, basket and pre-ordering")
struct FoodOrderTests {
    let menu = PreviewFixtures.menu

    @Test func menuGroupsSpecialsTieInsAndDeals() {
        #expect(menu.specials.map(\.id) == ["ember-bucket", "tide-caramel", "hot-choc", "combo-duo", "combo-family"])
        #expect(menu.filmTieIns.map(\.film.title) == ["Saltmarsh", "Ember Protocol"])
        #expect(menu.filmTieIns.last?.items.map(\.id) == ["ember-bucket"])
        #expect(Set(menu.deals.map(\.id)) == ["combo-duo", "combo-family", "ember-bucket"])
        let family = try! #require(menu.product(id: "combo-family"))
        #expect(family.savingMinor == 495)
        let bucket = try! #require(menu.product(id: "ember-bucket"))
        #expect(bucket.displayBadge == "Limited edition")
        #expect(bucket.savingMinor == nil)
        #expect(menu.product(id: "pop-salt")?.displayBadge == nil)
    }

    @Test func decodesSpecialsFromTheServerAndToleratesOlderServers() throws {
        let json = """
        {"id":"p1","sku":"EMBER-BUCKET","name":"Bucket","description":null,"priceMinor":1295,"allergens":[],"dietary":[],"calories":null,"stockStatus":"inStock",
         "modifierGroups":[],"bundleItems":[],"image":null,"featured":true,"badge":null,"limitedEdition":true,"compareAtMinor":null,
         "film":{"id":"f1","title":"Ember Protocol"},"availableUntil":"2026-12-24T00:00:00.000Z"}
        """
        let p = try APIClient.decoder.decode(ConcessionProduct.self, from: Data(json.utf8))
        #expect(p.isFeatured && p.isLimitedEdition && p.film?.title == "Ember Protocol" && p.availableUntil != nil)
        let old = """
        {"id":"p2","sku":"X","name":"Old","description":null,"priceMinor":100,"allergens":[],"dietary":[],"calories":null,"stockStatus":"inStock","modifierGroups":[],"bundleItems":[],"image":null}
        """
        let o = try APIClient.decoder.decode(ConcessionProduct.self, from: Data(old.utf8))
        #expect(!o.isFeatured && o.film == nil && o.savingMinor == nil)
    }

    @Test func basketMergesIdenticalLinesAndDropsUnavailableOnes() {
        var basket = FoodBasket()
        basket.add(BasketItem(productId: "hot-choc", modifiers: ["toppings": ["cream", "marshmallows"]]))
        basket.add(BasketItem(productId: "hot-choc", quantity: 2, modifiers: ["toppings": ["marshmallows", "cream"]]))
        basket.add(BasketItem(productId: "hot-choc"))
        #expect(basket.items.count == 2)
        #expect(basket.count == 4)
        #expect(basket.estimatedSubtotal(in: menu) == 3 * 495 + 395)
        basket.setQuantity(0, for: basket.items[1].id)
        #expect(basket.count == 3)
        basket.add(BasketItem(productId: "icecream"))
        basket.add(BasketItem(productId: "gone"))
        basket.keepOnly(in: menu)
        #expect(basket.items.map(\.productId) == ["hot-choc"])
    }

    @Test func picksBookingsThatCanStillTakeAPreorder() {
        let now = Date()
        func booking(_ id: String, venue: String, startsIn hours: Double, open: Bool = true, status: Booking.Status = .CONFIRMED) -> Booking {
            let start = now.addingTimeInterval(hours * 3600)
            return Booking(id: id, reference: id, status: status, createdAt: now, confirmedAt: now,
                           screening: .init(id: "s", startsAt: start, endsAt: start.addingTimeInterval(7200), localDate: "", formats: [], attributes: []),
                           film: .init(id: "f", title: "F", certificate: "12A", runtimeMinutes: 100, poster: nil, backdrop: nil),
                           venue: .init(id: venue, name: venue, timeZone: "Europe/London", address: .init(line1: "", city: "", postcode: ""), coordinate: .init(latitude: 0, longitude: 0)),
                           auditorium: .init(id: "a", name: "Screen 1", screenNumber: 1), seats: [],
                           totals: .init(currency: "GBP", subtotalMinor: 0, feesMinor: 0, discountMinor: 0, totalMinor: 0),
                           payment: nil, admission: nil, wallet: .init(available: false, status: nil),
                           preorder: .init(open: open, closesAt: start.addingTimeInterval(-900)))
        }
        let list = [
            booking("later-here", venue: "leeds", startsIn: 48),
            booking("soon-elsewhere", venue: "york", startsIn: 3),
            booking("soon-here", venue: "leeds", startsIn: 5),
            booking("closing", venue: "leeds", startsIn: 0.2),
            booking("closed", venue: "leeds", startsIn: 4, open: false),
            booking("refunded", venue: "leeds", startsIn: 4, status: .REFUNDED),
        ]
        #expect(FoodPreorder.eligibleBookings(list, venueId: "leeds", now: now).map(\.id) == ["soon-here", "later-here", "soon-elsewhere"])
        #expect(FoodPreorder.eligibleBookings(list, venueId: nil, now: now).map(\.id) == ["soon-elsewhere", "soon-here", "later-here"])
    }

    @Test func preordersFoodForABookingWithTheMemberDiscount() async throws {
        let svc = MockCinemaService()
        await svc.setLatency(.zero)
        let s = try await svc.screening(id: "preview-standard")
        let a = try await svc.availability(screeningId: s.id)
        let sel = SeatSelectionModel(screening: s, availability: a, maxTickets: 10)
        let f = BookingFlowModel(service: svc, selection: sel, formatters: Formatters())
        let seat = sel.layout.seats.first { sel.presentation(for: $0).state == .available && $0.type == .standard && $0.restrictedView == nil
            && sel.rulesEngine.evaluate(selected: [$0.id], unavailable: sel.unavailableSeatIds).warnings.isEmpty }!.id
        sel.toggle(seat)
        await f.reserveSeats()
        f.continueToReview(); f.continueToReview()
        await f.pay()
        let booking = try #require(f.booking)
        #expect(booking.canPreorder(now: Date()))

        _ = try await svc.purchaseMembership(planId: "plan-premiere", simulateDecline: false, idempotencyKey: "m1")
        let items = [BasketItem(productId: "combo-family", modifiers: ["popcorn": ["sweet"]])]
        let q = try await svc.quoteFoodPreorder(bookingId: booking.id, items: items, fulfilment: .collect)
        #expect(q.subtotalMinor == 2295)
        #expect(q.discountMinor == 2295 * 15 / 100)
        #expect(q.totalMinor == 2295 - 2295 * 15 / 100)

        await #expect(throws: APIError.self) { try await svc.placeFoodPreorder(bookingId: booking.id, items: items, fulfilment: .collect, simulateDecline: true, idempotencyKey: "k0") }
        let updated = try await svc.placeFoodPreorder(bookingId: booking.id, items: items, fulfilment: .collect, simulateDecline: false, idempotencyKey: "k1")
        let again = try await svc.placeFoodPreorder(bookingId: booking.id, items: items, fulfilment: .collect, simulateDecline: false, idempotencyKey: "k1")
        #expect(updated.concessions?.map(\.name) == ["Family sharing bundle"])
        #expect(again.totals.totalMinor == updated.totals.totalMinor)
        #expect(updated.totals.totalMinor == booking.totals.totalMinor + q.totalMinor)
    }
}
