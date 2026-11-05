import Foundation
import Testing
@testable import CinemaCore

/// Seat rules mirror backend/src/holds/seat-rules.spec.ts on the same fixtures.
@Suite("Seat rules engine")
struct SeatRulesEngineTests {
    let standard = try! Fixtures.layout("standard")
    let premiere = try! Fixtures.layout("premiere")

    func engine(_ layout: AuditoriumLayout, _ rules: SeatRules = SeatRules()) -> SeatRulesEngine { SeatRulesEngine(layout: layout, rules: rules) }

    @Test func aisleBreaksAdjacency() {
        let e = engine(standard)
        #expect(e.neighbours(of: "C-7").right == nil)
        #expect(e.neighbours(of: "C-8").left == nil)
        #expect(e.neighbours(of: "C-6").right == "C-7")
    }

    @Test func orphanSeatPolicyWarnsBlocksOrAllows() {
        let warn = engine(standard).evaluate(selected: ["C-1"], unavailable: ["C-3"])
        #expect(warn.isValid)
        #expect(warn.warnings.first { $0.code == "orphan_seat" }?.seatIds == ["C-2"])
        #expect(warn.warnings.first { $0.code == "orphan_seat" }?.message.contains("C2") == true)
        let block = engine(standard, SeatRules(orphanSeatPolicy: .block)).evaluate(selected: ["C-1"], unavailable: ["C-3"])
        #expect(block.errors.first?.code == "orphan_seat")
        #expect(engine(standard, SeatRules(orphanSeatPolicy: .allow)).evaluate(selected: ["C-1"], unavailable: ["C-3"]).warnings.isEmpty)
    }

    @Test func preExistingGapsAreNotTheCustomersFault() {
        let r = engine(standard).evaluate(selected: ["F-10"], unavailable: ["C-1", "C-3"])
        #expect(!r.warnings.contains { $0.code == "orphan_seat" })
    }

    @Test func vipBedsAndSofasAreSoldAsPairs() {
        let r = engine(premiere).evaluate(selected: ["D-1"], unavailable: [])
        #expect(r.errors.first?.code == "group_incomplete")
        #expect(r.errors.first?.message.hasPrefix("VIP beds") == true)
        #expect(engine(premiere).evaluate(selected: ["D-1", "D-2"], unavailable: []).isValid)
    }

    @Test func companionPolicyIsOperatorConfigurable() {
        let strict = engine(standard, SeatRules(companionPolicy: .requireWheelchair))
        #expect(strict.evaluate(selected: ["A-1"], unavailable: []).errors.first?.code == "companion_requires_wheelchair")
        #expect(strict.evaluate(selected: ["A-W1", "A-1"], unavailable: []).isValid)
        #expect(engine(standard, SeatRules(companionPolicy: .none)).evaluate(selected: ["A-1"], unavailable: []).warnings.allSatisfy { $0.code != "companion_seat" })
        #expect(engine(standard).evaluate(selected: ["A-1"], unavailable: []).warnings.contains { $0.code == "companion_seat" })
    }

    @Test func wheelchairSpacesInformButNeverBlock() {
        let r = engine(standard, SeatRules(orphanSeatPolicy: .block, companionPolicy: .requireWheelchair)).evaluate(selected: ["A-W1"], unavailable: [])
        #expect(r.isValid)
        #expect(r.warnings.contains { $0.code == "wheelchair_space" })
    }

    @Test func maximumSeatsPerBooking() {
        let r = engine(standard, SeatRules(maxTickets: 2)).evaluate(selected: ["D-1", "D-2", "D-3"], unavailable: [])
        #expect(r.errors.first?.code == "max_tickets")
    }
}

@Suite("Seat map taps")
struct SeatTapTests {
    let layout = try! Fixtures.layout("standard")
    let size = Vec2(430, 520)

    @Test func overviewTapZoomsTowardsTheArea() {
        let g = SeatMapGeometry(layout: layout)
        var t = SeatTapInterpreter()
        t.minimumSelectableSeatSize = 1000 // force "too small to select"
        #expect(t.interpret(point: Vec2(200, 200), at: Date(), geometry: g, camera: g.fitCamera, size: size) == .focusArea(anchor: Vec2(200, 200)))
    }

    @Test func singleTapOnSeatTogglesImmediately() {
        let g = SeatMapGeometry(layout: layout)
        let s = layout.seats.first { $0.id == "F-5" }!
        let cam = g.focus(on: s, size: size)
        var t = SeatTapInterpreter()
        let p = g.viewport(camera: cam, size: size).toScreen(Vec2(s.x, s.y))
        #expect(t.interpret(point: p, at: Date(), geometry: g, camera: cam, size: size) == .toggle("F-5"))
    }

    @Test func doubleTapOnEmptySpaceZoomsThenResetsAtMax() {
        let g = SeatMapGeometry(layout: layout)
        let left = layout.seats.first { $0.id == "E-7" }!, right = layout.seats.first { $0.id == "E-8" }!
        let aisle = Vec2((left.x + right.x) / 2, left.y)
        let cam = g.clamp(SeatMapCamera(zoom: 2.5, center: aisle), size: size)
        let p = g.viewport(camera: cam, size: size).toScreen(aisle)
        var t = SeatTapInterpreter()
        let now = Date()
        #expect(t.interpret(point: p, at: now, geometry: g, camera: cam, size: size) == .none)
        #expect(t.interpret(point: p, at: now.addingTimeInterval(0.2), geometry: g, camera: cam, size: size) == .zoomIn(anchor: p))
        // Too slow: not a double tap.
        _ = t.interpret(point: p, at: now.addingTimeInterval(1), geometry: g, camera: cam, size: size)
        #expect(t.interpret(point: p, at: now.addingTimeInterval(1.5), geometry: g, camera: cam, size: size) == .none)
        let maxCam = g.clamp(SeatMapCamera(zoom: 100, center: aisle), size: size)
        let pm = g.viewport(camera: maxCam, size: size).toScreen(aisle)
        _ = t.interpret(point: pm, at: now.addingTimeInterval(3), geometry: g, camera: maxCam, size: size)
        #expect(t.interpret(point: pm, at: now.addingTimeInterval(3.1), geometry: g, camera: maxCam, size: size) == .resetZoom)
    }
}

@MainActor
@Suite("Configurable seat categories")
struct SeatCategoryTests {
    @Test func operatorCategoriesDriveLabelsIconsAndLegend() {
        let screening = PreviewFixtures.screening(.premiere)
        let m = SeatSelectionModel(screening: screening, availability: Fixtures.snapshot(screening.layout), maxTickets: 10)
        #expect(m.categoriesInLayout.map(\.label) == ["Luxe Pod", "VIP Bed"])
        let pod = screening.layout.seats.first { $0.id == "B-2" }!
        #expect(m.presentation(for: pod).symbolName == "sparkles")
        #expect(m.accessibilityLabel(for: pod, formatters: Formatters()) == "Row B, Seat 2, luxe pod, available, £24.95.")
        let bed = screening.layout.seats.first { $0.id == "E-3" }!
        #expect(m.accessibilityLabel(for: bed, formatters: Formatters()).contains("VIP bed, sold in pairs"))
    }

    @Test func untrustedIconsAreIgnored() {
        let c = SeatCategory(id: "x", label: "X", shape: .seat, icon: "trash.fill")
        #expect(c.safeIcon == nil)
    }

    @Test func unknownCategoryFallsBackGracefully() {
        let screening = PreviewFixtures.screening(.standard)
        var s = screening; s.seatCategories = nil
        let m = SeatSelectionModel(screening: s, availability: Fixtures.snapshot(s.layout), maxTickets: 10)
        #expect(m.categoriesInLayout.map(\.id) == ["standard", "premium"])
    }

    @Test func continueIsBlockedWithAnExplanationWhenRulesFail() {
        let screening = PreviewFixtures.screening(.standard, rules: SeatRules(orphanSeatPolicy: .block))
        let m = SeatSelectionModel(screening: screening, availability: Fixtures.snapshot(screening.layout, overrides: ["C-3": .sold]), maxTickets: 10)
        m.toggle("C-1")
        #expect(m.canContinue == false)
        #expect(m.blockingReason?.contains("single empty seat") == true)
        m.toggle("C-2") // C-1 + C-2 fills the gap up to the sold seat
        #expect(m.canContinue)
        m.toggle("C-1") // C-2 alone would strand C-1 against the wall
        #expect(m.blockingReason?.contains("C1") == true)
    }

    @Test func modelHandlesDoubleTapZoomAndSelection() {
        let screening = PreviewFixtures.screening(.standard)
        let m = SeatSelectionModel(screening: screening, availability: Fixtures.snapshot(screening.layout), maxTickets: 10)
        let size = Vec2(430, 520)
        // Overview: first tap zooms rather than guessing a tiny seat.
        let r1 = m.handleTap(at: Vec2(215, 260), size: size)
        #expect(r1.toggle == nil && (r1.camera?.zoom ?? 1) > 1)
        m.camera = m.geometry.focus(on: screening.layout.seats.first { $0.id == "G-4" }!, size: size)
        let seat = screening.layout.seats.first { $0.id == "G-4" }!
        let p = m.geometry.viewport(camera: m.camera, size: size).toScreen(Vec2(seat.x, seat.y))
        #expect(m.handleTap(at: p, size: size).toggle == .selected(["G-4"]))
    }
}

@Suite("Preview fixtures")
struct PreviewFixtureTests {
    @Test func bundledLayoutsMatchSharedFixtures() throws {
        for name in PreviewFixtures.LayoutName.allCases {
            #expect(PreviewFixtures.layout(name) == (try Fixtures.layout(name.rawValue)), "\(name) is out of sync; run pnpm fixtures:layouts")
        }
        #expect(PreviewFixtures.config("northlight").tenant.slug == "northlight")
        #expect(PreviewFixtures.config("kestrel").typography.design == .serif)
    }

    @Test func availabilityIsDeterministicAndRealistic() {
        let s = PreviewFixtures.screening(.curved)
        let a = PreviewFixtures.availability(for: s), b = PreviewFixtures.availability(for: s)
        #expect(a.seats == b.seats)
        let sold = a.seats.values.filter { $0 == .sold }.count
        #expect(sold > 10 && sold < s.layout.seats.count / 2)
    }
}
