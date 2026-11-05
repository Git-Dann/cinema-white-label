import Foundation
import Testing
@testable import CinemaCore

@Suite("Live Activity and widget policy")
struct LiveActivityTests {
    let config = try! Fixtures.config("northlight")
    let start = Date(timeIntervalSince1970: 1_800_000_000)

    func booking(startsIn: TimeInterval, now: Date, status: Booking.Status = .CONFIRMED, food: Bool = false) -> Booking {
        let s = now.addingTimeInterval(startsIn)
        return Booking(
            id: "b1", reference: "ABC1234", status: status, createdAt: now, confirmedAt: now,
            screening: .init(id: "s1", startsAt: s, endsAt: s.addingTimeInterval(9000), localDate: "2027-01-15", formats: ["2D"], attributes: []),
            film: .init(id: "f", title: "Ember Protocol", certificate: "12A", runtimeMinutes: 141, poster: nil, backdrop: nil),
            venue: .init(id: "v", name: "Northlight Leeds Riverside", timeZone: "Europe/London", address: .init(line1: "12 Wharf Approach", city: "Leeds", postcode: "LS1 4AB"), coordinate: .init(latitude: 53.79, longitude: -1.54)),
            auditorium: .init(id: "a", name: "Screen 2", screenNumber: 2),
            seats: [.init(seatId: "H-8", rowLabel: "H", seatLabel: "8", ticketTypeId: "adult", priceMinor: 1250), .init(seatId: "H-9", rowLabel: "H", seatLabel: "9", ticketTypeId: "adult", priceMinor: 1250)],
            totals: .init(currency: "GBP", subtotalMinor: 2500, feesMinor: 190, discountMinor: 0, totalMinor: 2690, concessionsMinor: food ? 650 : 0, voucherCode: nil),
            payment: nil, admission: .init(barcode: "SECRET-CODE", format: "qr"), wallet: .init(available: false, status: nil),
            concessions: food ? [.init(name: "Sweet popcorn", quantity: 1, modifiers: [], lineTotalMinor: 650)] : [], fulfilment: food ? .seatDelivery : .collect, cancellation: nil
        )
    }

    @Test func phasesFollowTheClock() {
        let end = start.addingTimeInterval(9000)
        #expect(LiveActivityPolicy.phase(startsAt: start, endsAt: end, now: start.addingTimeInterval(-3600)) == .upcoming)
        #expect(LiveActivityPolicy.phase(startsAt: start, endsAt: end, now: start.addingTimeInterval(-20 * 60)) == .doorsOpen)
        #expect(LiveActivityPolicy.phase(startsAt: start, endsAt: end, now: start.addingTimeInterval(-5 * 60)) == .startingSoon)
        #expect(LiveActivityPolicy.phase(startsAt: start, endsAt: end, now: start.addingTimeInterval(60)) == .started)
        #expect(LiveActivityPolicy.phase(startsAt: start, endsAt: end, now: end) == .ended)
    }

    @Test func startsOnlyForConfirmedBookingsWithinTheWindow() {
        let now = start
        #expect(LiveActivityPolicy.shouldStart(booking(startsIn: 2 * 3600, now: now), now: now))
        #expect(!LiveActivityPolicy.shouldStart(booking(startsIn: 6 * 3600, now: now), now: now))
        #expect(LiveActivityPolicy.shouldStart(booking(startsIn: 26 * 3600, now: now), now: now, demo: true))
        #expect(!LiveActivityPolicy.shouldStart(booking(startsIn: 2 * 3600, now: now, status: .REFUNDED), now: now))
        #expect(!LiveActivityPolicy.shouldStart(booking(startsIn: -4 * 3600, now: now), now: now)) // already finished
    }

    @Test func stateTextIsHelpfulAndNeverContainsTheAdmissionCode() {
        let now = start
        let content = ScreeningActivityContent(booking: booking(startsIn: 20 * 60, now: now, food: true), config: config)
        let s = LiveActivityPolicy.state(for: content, now: now)
        #expect(s.phase == .doorsOpen)
        #expect(s.detail.contains("Seats H8, H9"))
        #expect(s.detail.contains("brought to your seat"))
        let encoded = String(decoding: try! JSONEncoder().encode(content), as: UTF8.self)
        #expect(!encoded.contains("SECRET-CODE"))
        #expect(content.deepLink == "cinema-northlight://tickets")
        #expect(content.accentHex == config.theme.dark.actionPrimary)
    }

    @Test func schedulesUpdatesAtPhaseBoundariesAndEndsAfterTheFilm() {
        let end = start.addingTimeInterval(9000)
        #expect(LiveActivityPolicy.nextChange(startsAt: start, endsAt: end, now: start.addingTimeInterval(-3600)) == start.addingTimeInterval(-30 * 60))
        #expect(LiveActivityPolicy.nextChange(startsAt: start, endsAt: end, now: start.addingTimeInterval(60)) == end)
        #expect(LiveActivityPolicy.nextChange(startsAt: start, endsAt: end, now: end) == nil)
        let content = ScreeningActivityContent(booking: booking(startsIn: 3600, now: start), config: config)
        #expect(LiveActivityPolicy.dismissalDate(for: content) == content.endsAt.addingTimeInterval(900))
    }

    @Test func widgetShowsTheNextUpcomingBookingOnly() {
        let now = start
        let later = booking(startsIn: 48 * 3600, now: now)
        var sooner = booking(startsIn: 3 * 3600, now: now); sooner.id = "b2"; sooner.film.title = "Signal Lost"
        var past = booking(startsIn: -24 * 3600, now: now); past.id = "b0"
        let snap = WidgetSnapshot.make(bookings: [later, past, sooner], config: config, now: now)
        #expect(snap.next?.filmTitle == "Signal Lost")
        #expect(snap.upcomingCount == 2)
        #expect(!snap.isDemo)
        #expect(snap.timelineDates(now: now).first == now)
        #expect(WidgetSnapshot.make(bookings: [], config: config, now: now).next == nil)
        #expect(WidgetSnapshot.demo(config: config, now: now).isDemo)
    }

    @Test func snapshotStoreIsUnavailableWithoutAnAppGroup() {
        // Linux and unsigned builds have no App Group container: the widget falls back to demo content.
        let store = WidgetSnapshotStore(suiteName: "group.example.missing")
        #if canImport(Darwin)
        #expect(store.isAvailable == false)
        #else
        _ = store
        #endif
    }
}
