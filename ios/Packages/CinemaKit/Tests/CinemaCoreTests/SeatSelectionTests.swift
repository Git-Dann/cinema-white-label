import Foundation
import Testing
@testable import CinemaCore

@MainActor
@Suite("Seat selection")
struct SeatSelectionTests {
    let standard: AuditoriumLayout
    let luxe: AuditoriumLayout

    init() throws {
        standard = try Fixtures.layout("standard")
        luxe = try Fixtures.layout("luxe")
    }

    func model(_ layout: AuditoriumLayout, _ overrides: [String: SeatAvailability] = [:], max: Int = 10) -> SeatSelectionModel {
        SeatSelectionModel(screening: Fixtures.screening(layout: layout), availability: Fixtures.snapshot(layout, overrides: overrides), maxTickets: max)
    }

    @Test func selectsAndDeselects() {
        let m = model(standard)
        #expect(m.toggle("F-8") == .selected(["F-8"]))
        #expect(m.selectedSeatIds == ["F-8"])
        #expect(m.estimatedTotalMinor == 1250 + 95)
        #expect(m.toggle("F-8") == .deselected(["F-8"]))
        #expect(m.selectedSeatIds.isEmpty)
    }

    @Test func refusesSoldHeldAndBlockedSeatsWithExplanation() {
        let m = model(standard, ["F-1": .sold, "F-2": .held, "F-3": .blocked])
        for id in ["F-1", "F-2", "F-3"] {
            guard case .rejected = m.toggle(id) else { Issue.record("expected rejection for \(id)"); continue }
        }
        #expect(m.selectedSeatIds.isEmpty)
        #expect(m.message?.kind == .error)
    }

    @Test func selectsSofasAsPairsAndExplains() {
        let m = model(luxe)
        #expect(m.toggle("E-1") == .selected(["E-1", "E-2"]))
        #expect(m.message?.text.contains("pairs") == true)
        #expect(m.toggle("E-2") == .deselected(["E-1", "E-2"]))
    }

    @Test func refusesSofaWhenPartnerTaken() {
        let m = model(luxe, ["E-2": .sold])
        guard case .rejected(let why) = m.toggle("E-1") else { Issue.record("expected rejection"); return }
        #expect(why.contains("E2"))
    }

    @Test func enforcesTicketLimit() {
        let m = model(standard, max: 2)
        m.toggle("D-1"); m.toggle("D-2")
        guard case .rejected = m.toggle("D-3") else { Issue.record("expected limit"); return }
        #expect(m.selectedSeatIds.count == 2)
    }

    @Test func flagsConflictsInsteadOfSilentlyRemovingSeats() {
        let m = model(standard)
        m.toggle("H-5"); m.toggle("H-6")
        m.apply(change: AvailabilityChange(screeningId: "scr_1", changes: [.init(seatId: "H-6", state: .sold)]))
        #expect(m.selectedSeatIds == ["H-5", "H-6"]) // still there
        #expect(m.conflicts == ["H-6"])
        #expect(m.canContinue == false)
        #expect(m.message?.text == "H6 has just been taken. Remove it and choose another seat.")
        #expect(m.presentation(for: standard.seats.first { $0.id == "H-6" }!).state == .conflict)
        m.removeConflicts()
        #expect(m.selectedSeatIds == ["H-5"])
        #expect(m.canContinue)
    }

    @Test func ownHoldIsNotAConflict() {
        let m = model(standard)
        m.toggle("C-3")
        m.apply(change: AvailabilityChange(screeningId: "scr_1", changes: [.init(seatId: "C-3", state: .held)]), ownHoldSeatIds: ["C-3"])
        #expect(m.conflicts.isEmpty)
        #expect(m.presentation(for: standard.seats.first { $0.id == "C-3" }!).state == .selected)
    }

    @Test func restoresSelectionFromExistingHold() {
        let hold = AvailabilitySnapshot.HoldRef(id: "h1", seatIds: ["B-2", "B-3"], expiresAt: Date().addingTimeInterval(300))
        let m = SeatSelectionModel(screening: Fixtures.screening(layout: standard), availability: Fixtures.snapshot(standard, overrides: ["B-2": .held, "B-3": .held], hold: hold), maxTickets: 10)
        #expect(m.selectedSeatIds == ["B-2", "B-3"])
        #expect(m.conflicts.isEmpty)
    }

    @Test func accessibleDescriptionsUseRealPrices() {
        let m = model(standard, ["F-9": .sold])
        let f = Formatters()
        let f8 = standard.seats.first { $0.id == "F-8" }!
        #expect(m.accessibilityLabel(for: f8, formatters: f) == "Row F, Seat 8, standard, available, £12.50.")
        let f9 = standard.seats.first { $0.id == "F-9" }!
        #expect(m.accessibilityLabel(for: f9, formatters: f) == "Row F, Seat 9, standard, sold.")
        let wc = standard.seats.first { $0.id == "A-W1" }!
        #expect(m.accessibilityLabel(for: wc, formatters: f).hasPrefix("Row A, Wheelchair space 1, wheelchair space, available"))
        let premium = standard.seats.first { $0.id == "K-4" }!
        #expect(m.accessibilityLabel(for: premium, formatters: f) == "Row K, Seat 4, premium, available, £15.50.")
    }

    @Test func accessibleRowsFollowExplicitOrderNotGeometry() {
        let m = model(standard)
        let rows = m.accessibleRows
        #expect(rows.first?.label == "A")
        #expect(rows.first?.seats.first?.id == "A-W1")
        #expect(rows.last?.section == "Premium")
        #expect(rows.flatMap(\.seats).count == standard.seats.count)
    }

    @Test func stateIsNeverConveyedByColourAlone() {
        let m = model(standard, ["B-1": .sold, "B-2": .blocked])
        m.toggle("B-3")
        let symbols = ["B-1", "B-2", "B-3"].map { id in m.presentation(for: standard.seats.first { $0.id == id }!).symbolName }
        #expect(symbols == ["xmark", "minus", "checkmark"])
        #expect(m.presentation(for: standard.seats.first { $0.id == "A-W1" }!).symbolName == "figure.roll")
    }
}
