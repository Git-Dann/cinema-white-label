import Foundation
import Testing
@testable import CinemaCore

@MainActor
@Suite("Loyalty points and memberships")
struct LoyaltyTests {
    func makeFlow(_ service: MockCinemaService, seats: Int = 2) async throws -> BookingFlowModel {
        await service.setLatency(.zero)
        let s = try await service.screening(id: "preview-standard")
        let a = try await service.availability(screeningId: s.id)
        let sel = SeatSelectionModel(screening: s, availability: a, maxTickets: 10)
        let flow = BookingFlowModel(service: service, selection: sel, formatters: Formatters())
        let free = sel.layout.seats.filter { sel.presentation(for: $0).state == .available && $0.type == .standard && $0.restrictedView == nil }
        // Adjacent seats in one row so no rule warnings get in the way.
        let row = Dictionary(grouping: free, by: \.rowId).values.first { $0.count >= seats + 2 }!.sorted { $0.order < $1.order }
        for seat in row.dropFirst().prefix(seats) { _ = sel.toggle(seat.id) }
        await flow.reserveSeats()
        return flow
    }

    @Test func redeemOptionsAreWholePoundsWithinTheMaximum() {
        let q = Quote.LoyaltyQuote(name: "R", earnPointsPerPound: 10, redeemPointsPerPound: 200, minRedeemPoints: 300, balance: 1000, pointsRedeemed: 0, pointsDiscountMinor: 0, pointsToEarn: 0, maxRedeemablePoints: 1000)
        #expect(q.redeemOptions == [0, 400, 600, 800, 1000])
        #expect(q.valueMinor(of: 600) == 300)
        var none = q
        none.maxRedeemablePoints = 0
        #expect(none.redeemOptions == [0])
    }

    @Test func benefitsReadNaturally() {
        let e = MembershipPlan.Entitlements(ticketDiscountPercent: 10, foodDiscountPercent: 0, bookingFeeWaived: true, pointsMultiplier: 1.5)
        #expect(e.benefits == ["10% off tickets", "No booking fees", "1.5× points"])
        #expect(MembershipPlan.Entitlements(pointsMultiplier: 2).benefits == ["2× points"])
    }

    @Test func offersRenewalOnlyForTheCurrentPlan() {
        let plans = PreviewFixtures.membershipPlans
        let end = Date().addingTimeInterval(86400 * 10)
        let current = Membership(plan: plans[0], status: "active", startedAt: Date(), currentPeriodEnd: end)
        #expect(MembershipOffer.offer(for: plans[0], current: nil) == .join)
        #expect(MembershipOffer.offer(for: plans[0], current: current) == .renew)
        #expect(MembershipOffer.offer(for: plans[1], current: current) == .unavailable(until: end))
        var expired = current
        expired.status = "expired"
        #expect(MembershipOffer.offer(for: plans[1], current: expired) == .join)
    }

    @Test func decodesServerQuoteWithDiscountsAndLoyalty() throws {
        let json = """
        {"currency":"GBP","lines":[],"subtotalMinor":2500,"feesMinor":0,"discountMinor":450,"totalMinor":2050,"feeLabel":null,
         "discounts":[{"kind":"membership","label":"Northlight Plus member discount","amountMinor":250},{"kind":"points","label":"400 points","amountMinor":200}],
         "membership":{"planName":"Northlight Plus","discountMinor":250,"feeWaivedMinor":190},
         "loyalty":{"name":"Northlight Rewards","earnPointsPerPound":10,"redeemPointsPerPound":200,"minRedeemPoints":200,"balance":1000,"pointsRedeemed":400,"pointsDiscountMinor":200,"pointsToEarn":307,"maxRedeemablePoints":1000}}
        """
        let q = try APIClient.decoder.decode(Quote.self, from: Data(json.utf8))
        #expect(q.discounts?.map(\.kind) == ["membership", "points"])
        #expect(q.membership?.feeWaivedMinor == 190)
        #expect(q.loyalty?.pointsToEarn == 307)
        // Older servers without these fields still decode.
        let old = try APIClient.decoder.decode(Quote.self, from: Data(#"{"currency":"GBP","lines":[],"subtotalMinor":1,"feesMinor":0,"discountMinor":0,"totalMinor":1,"feeLabel":null}"#.utf8))
        #expect(old.loyalty == nil && old.discounts == nil)
    }

    @Test func spendsPointsAndEarnsOnWhatIsPaid() async throws {
        let service = MockCinemaService()
        let flow = try await makeFlow(service)
        let before = try #require(flow.quote)
        let loyalty = try #require(before.loyalty)
        #expect(loyalty.balance == 640)
        #expect(loyalty.redeemOptions == [0, 200, 400, 600])

        await flow.setLoyaltyPoints(400)
        let q = try #require(flow.quote)
        #expect(q.loyalty?.pointsDiscountMinor == 200)
        #expect(q.totalMinor == before.totalMinor - 200)
        #expect(q.discounts?.last == .init(kind: "points", label: "400 points", amountMinor: 200))

        await flow.pay()
        let booking = try #require(flow.booking)
        #expect(booking.totals.pointsRedeemed == 400)
        let summary = try await service.loyalty()
        #expect(summary.points == 640 - 400 + (q.loyalty?.pointsToEarn ?? 0))
        #expect(summary.history.first?.reason == "earn")
    }

    @Test func invalidPointsFallBackToNoneWithAMessage() async throws {
        let service = MockCinemaService()
        let flow = try await makeFlow(service)
        await flow.setLoyaltyPoints(300)
        #expect(flow.loyaltyPoints == 0)
        #expect(flow.pointsMessage?.contains("steps of 200") == true)
        #expect(flow.quote?.loyalty?.pointsRedeemed == 0)
    }

    @Test func membershipBenefitsApplyAfterJoining() async throws {
        let service = MockCinemaService()
        await service.setLatency(.zero)
        let plus = PreviewFixtures.membershipPlans[0]
        let m = try await service.purchaseMembership(planId: plus.id, simulateDecline: false, idempotencyKey: "k")
        #expect(m.isActive)
        await #expect(throws: APIError.self) { _ = try await service.purchaseMembership(planId: PreviewFixtures.membershipPlans[1].id, simulateDecline: false, idempotencyKey: "k2") }

        let flow = try await makeFlow(service)
        let q = try #require(flow.quote)
        #expect(q.feesMinor == 0)
        #expect(q.membership?.planName == "Northlight Plus")
        #expect(q.membership?.discountMinor == q.subtotalMinor / 10)
        #expect(q.totalMinor == q.subtotalMinor - q.subtotalMinor / 10)
    }

    @Test func cancellingReturnsPoints() async throws {
        let service = MockCinemaService()
        let flow = try await makeFlow(service)
        await flow.setLoyaltyPoints(200)
        await flow.pay()
        let booking = try #require(flow.booking)
        _ = try await service.cancelBooking(id: booking.id)
        #expect(try await service.loyalty().points == 640)
    }

    @Test func membershipBenefitsReadStrongestFirstWithSymbols() {
        let e = MembershipPlan.Entitlements(ticketDiscountPercent: 25, foodDiscountPercent: 15, bookingFeeWaived: true, pointsMultiplier: 2)
        #expect(e.benefitItems.map(\.title) == ["25% off tickets", "No booking fees", "15% off food and drink", "2× points"])
        #expect(e.benefitItems.map(\.symbol) == ["ticket.fill", "creditcard.fill", "popcorn.fill", "sparkles"])
        #expect(MembershipPlan.Entitlements().benefitItems.isEmpty)
    }

    @Test func featuresTheStrongestPlanOnlyWhenThereIsAChoice() {
        let plus = MembershipPlan(id: "plus", name: "Plus", description: "", priceMinor: 699, interval: "month", entitlements: .init(ticketDiscountPercent: 10, bookingFeeWaived: true))
        let premiere = MembershipPlan(id: "premiere", name: "Premiere", description: "", priceMinor: 1499, interval: "month", entitlements: .init(ticketDiscountPercent: 25, foodDiscountPercent: 15, bookingFeeWaived: true, pointsMultiplier: 2))
        #expect([plus, premiere].featuredPlanID == "premiere")
        #expect([plus].featuredPlanID == nil)
        #expect([premiere, plus].cheapest?.id == "plus")
    }
}
