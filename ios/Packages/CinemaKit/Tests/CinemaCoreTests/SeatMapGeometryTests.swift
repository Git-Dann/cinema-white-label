import Foundation
import Testing
@testable import CinemaCore

@Suite("Seat map geometry and hit testing")
struct SeatMapGeometryTests {
    let standard: AuditoriumLayout
    let curved: AuditoriumLayout
    /// iPhone Pro Max-ish seat map area in points.
    let size = Vec2(430, 520)

    init() throws {
        standard = try Fixtures.layout("standard")
        curved = try Fixtures.layout("curved")
    }

    func seat(_ layout: AuditoriumLayout, _ id: String) -> Seat { layout.seats.first { $0.id == id }! }

    @Test func decodesSharedFixturesWithScreenAndSeats() {
        #expect(standard.seats.count == 140)
        #expect(curved.seats.count == 226)
        #expect(standard.screen.edge == .top)
        #expect(standard.screen.label == "SCREEN")
        #expect(Set(standard.seats.map(\.id)).count == standard.seats.count)
    }

    @Test func fitShowsWholeAuditorium() {
        let g = SeatMapGeometry(layout: standard)
        let vp = g.viewport(camera: g.fitCamera, size: size)
        for s in standard.seats {
            let p = vp.toScreen(Vec2(s.x, s.y))
            #expect(p.x >= 0 && p.x <= size.x && p.y >= 0 && p.y <= size.y)
        }
    }

    @Test func tapOnSeatCentreSelectsThatSeatAtEveryZoom() {
        let g = SeatMapGeometry(layout: standard)
        for zoom in [1.0, 2.0, g.maxZoom(for: size)] {
            for id in ["A-W1", "C-7", "C-8", "K-14", "F-3"] {
                let s = seat(standard, id)
                var cam = SeatMapCamera(zoom: zoom, center: Vec2(s.x, s.y))
                cam = g.clamp(cam, size: size)
                let p = g.viewport(camera: cam, size: size).toScreen(Vec2(s.x, s.y))
                #expect(g.hitTest(screenPoint: p, camera: cam, size: size)?.id == id, "zoom \(zoom) seat \(id)")
            }
        }
    }

    @Test func tapInCentralAisleSelectsNothing() {
        let g = SeatMapGeometry(layout: standard)
        let left = seat(standard, "E-7"), right = seat(standard, "E-8")
        let aisle = Vec2((left.x + right.x) / 2, left.y)
        for zoom in [1.0, 3.0] {
            let cam = g.clamp(SeatMapCamera(zoom: zoom, center: aisle), size: size)
            let p = g.viewport(camera: cam, size: size).toScreen(aisle)
            #expect(g.hitTest(screenPoint: p, camera: cam, size: size) == nil, "zoom \(zoom)")
        }
    }

    @Test func nearMissSnapsToClosestSeatButNotAcrossRows() {
        let g = SeatMapGeometry(layout: standard)
        let s = seat(standard, "D-4")
        let cam = g.fitCamera
        let vp = g.viewport(camera: cam, size: size)
        // Just outside the seat's right edge, inside the inter-seat gap.
        let p = vp.toScreen(Vec2(s.x + s.width * 0.6, s.y))
        let hit = g.hitTest(screenPoint: p, camera: cam, size: size)
        #expect(hit?.id == "D-4" || hit?.id == "D-5")
        #expect(hit?.rowId == "D")
    }

    @Test func zoomKeepsAnchorFixedAndPanIsClamped() {
        let g = SeatMapGeometry(layout: standard)
        let anchor = Vec2(300, 200)
        let before = g.viewport(camera: g.fitCamera, size: size).toLayout(anchor)
        let zoomed = g.zoom(g.fitCamera, by: 2.5, anchor: anchor, size: size)
        let after = g.viewport(camera: zoomed, size: size).toLayout(anchor)
        #expect(abs(before.x - after.x) < 1e-9 && abs(before.y - after.y) < 1e-9)

        let flung = g.pan(zoomed, by: Vec2(-100_000, -100_000), size: size)
        let rect = g.visibleRect(camera: flung, size: size)
        #expect(rect.origin.x + rect.size.x <= 1 + g.margin + 1e-9)
        #expect(rect.origin.y + rect.size.y <= standard.height + g.margin + 1e-9)
    }

    @Test func zoomLimitsMakeSeatsComfortablyTappable() {
        let g = SeatMapGeometry(layout: curved)
        let maxCam = SeatMapCamera(zoom: 1000, center: g.contentCenter)
        let clamped = g.clamp(maxCam, size: size)
        #expect(g.seatPointSize(camera: clamped, size: size) >= SeatMapGeometry.minimumTouchTarget)
        #expect(g.clamp(SeatMapCamera(zoom: 0.1, center: g.contentCenter), size: size).zoom == 1)
    }

    @Test func rotatedCurvedSeatsHitTestAccurately() {
        let g = SeatMapGeometry(layout: curved)
        let outer = curved.seats.filter { abs($0.rotation) > 5 }
        #expect(!outer.isEmpty)
        for s in outer.prefix(20) {
            let cam = g.focus(on: s, size: size)
            let vp = g.viewport(camera: cam, size: size)
            // A point inside the seat along its own rotated x-axis.
            let a = s.rotation * .pi / 180
            let inside = Vec2(s.x + cos(a) * s.width * 0.35, s.y + sin(a) * s.width * 0.35)
            #expect(s.contains(.init(x: inside.x, y: inside.y)))
            #expect(g.hitTest(screenPoint: vp.toScreen(inside), camera: cam, size: size)?.id == s.id)
        }
    }

    @Test func cameraSurvivesDisplaySizeChange() {
        // iPhone Duo: outer display → unfolded inner display.
        let g = SeatMapGeometry(layout: standard)
        let s = seat(standard, "G-10")
        let compact = Vec2(390, 480), expanded = Vec2(700, 640)
        let cam = g.focus(on: s, size: compact)
        let vpExpanded = g.viewport(camera: cam, size: expanded)
        let centre = vpExpanded.toScreen(Vec2(s.x, s.y))
        #expect(abs(centre.x - expanded.x / 2) < 1 && abs(centre.y - expanded.y / 2) < 1)
        #expect(g.hitTest(screenPoint: centre, camera: cam, size: expanded)?.id == "G-10")
    }

    @Test func screenCurveBowsAwayFromSeating() {
        let g = SeatMapGeometry(layout: standard)
        let pts = g.screenCurve()
        let mid = pts[pts.count / 2], end = pts[0]
        #expect(mid.y < end.y) // centre further from the audience (screen is at the top)
        #expect(pts.allSatisfy { $0.y >= 0 })
        let firstRowY = standard.seats.map(\.y).min()!
        #expect(pts.allSatisfy { $0.y < firstRowY })
    }

    @Test func rowLabelsSitOutsideTheRow() {
        let g = SeatMapGeometry(layout: standard)
        let labels = g.rowLabelPositions()
        #expect(labels.map(\.row.label) == ["A", "B", "C", "D", "E", "F", "G", "H", "J", "K"])
        let a = labels[0]
        #expect(a.left.x < standard.seats.filter { $0.rowId == "A" }.map(\.x).min()!)
    }
}
