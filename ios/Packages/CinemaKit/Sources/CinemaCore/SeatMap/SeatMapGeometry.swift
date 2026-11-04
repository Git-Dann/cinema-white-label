import Foundation

/// 2D vector in either layout units or screen points.
public struct Vec2: Sendable, Hashable {
    public var x: Double
    public var y: Double
    public init(_ x: Double, _ y: Double) { self.x = x; self.y = y }
    public static func + (a: Vec2, b: Vec2) -> Vec2 { Vec2(a.x + b.x, a.y + b.y) }
    public static func - (a: Vec2, b: Vec2) -> Vec2 { Vec2(a.x - b.x, a.y - b.y) }
    public static func * (a: Vec2, s: Double) -> Vec2 { Vec2(a.x * s, a.y * s) }
    public var length: Double { (x * x + y * y).squareRoot() }
}

/// Device-independent camera over a layout. Stored in the selection model so
/// the customer's zoom and position survive iPhone Duo fold/unfold and resizing.
public struct SeatMapCamera: Sendable, Hashable {
    /// Zoom relative to "fit whole auditorium" (1 = fit).
    public var zoom: Double
    /// Layout point shown at the centre of the view.
    public var center: Vec2
    public init(zoom: Double, center: Vec2) { self.zoom = zoom; self.center = center }
}

/// Screen transform for a given view size: screen = layout * scale + offset.
public struct SeatMapViewport: Sendable, Hashable {
    public var scale: Double
    public var offset: Vec2
    public func toScreen(_ p: Vec2) -> Vec2 { p * scale + offset }
    public func toLayout(_ p: Vec2) -> Vec2 { (p - offset) * (1 / scale) }
}

/// Geometry and hit-testing for a seat map. Pure value type; no UI framework.
public struct SeatMapGeometry: Sendable {
    public let layout: AuditoriumLayout
    /// Extra layout-unit margin around the canvas so edge seats are not flush.
    public let margin: Double = 0.02
    /// Minimum comfortable touch target (Apple HIG: 44pt).
    public static let minimumTouchTarget: Double = 44

    private let cellSize: Double
    private let grid: [GridKey: [Int]]
    private struct GridKey: Hashable { let x: Int; let y: Int }

    public init(layout: AuditoriumLayout) {
        self.layout = layout
        let typical = layout.seats.map(\.width).sorted().dropFirst(layout.seats.count / 2).first ?? 0.04
        self.cellSize = max(typical * 2, 0.02)
        var g: [GridKey: [Int]] = [:]
        for (i, s) in layout.seats.enumerated() {
            let r = max(s.width, s.height) / 2
            let x0 = Int(((s.x - r) / cellSize).rounded(.down)), x1 = Int(((s.x + r) / cellSize).rounded(.down))
            let y0 = Int(((s.y - r) / cellSize).rounded(.down)), y1 = Int(((s.y + r) / cellSize).rounded(.down))
            for gx in x0...x1 { for gy in y0...y1 { g[GridKey(x: gx, y: gy), default: []].append(i) } }
        }
        self.grid = g
    }

    // MARK: Camera and viewport

    public var contentSize: Vec2 { Vec2(1 + margin * 2, layout.height + margin * 2) }
    public var contentCenter: Vec2 { Vec2(0.5, layout.height / 2) }

    /// Points per layout unit that fits the whole auditorium in `size` (minus insets).
    public func fitScale(for size: Vec2) -> Double {
        guard size.x > 0, size.y > 0 else { return 1 }
        return min(size.x / contentSize.x, size.y / contentSize.y)
    }

    public var fitCamera: SeatMapCamera { SeatMapCamera(zoom: 1, center: contentCenter) }

    /// Highest zoom: a typical seat becomes ~1.6 × the minimum touch target.
    public func maxZoom(for size: Vec2) -> Double {
        let typical = layout.seats.map(\.width).min() ?? 0.04
        let needed = (Self.minimumTouchTarget * 1.6) / (typical * fitScale(for: size))
        return max(2, min(needed, 12))
    }

    public func viewport(camera: SeatMapCamera, size: Vec2) -> SeatMapViewport {
        let scale = fitScale(for: size) * camera.zoom
        return SeatMapViewport(scale: scale, offset: size * 0.5 - camera.center * scale)
    }

    /// Keeps zoom within limits and stops the auditorium being panned off-screen.
    public func clamp(_ camera: SeatMapCamera, size: Vec2) -> SeatMapCamera {
        var c = camera
        c.zoom = min(max(c.zoom, 1), maxZoom(for: size))
        let scale = fitScale(for: size) * c.zoom
        let halfVisible = Vec2(size.x / scale / 2, size.y / scale / 2)
        let minX = -margin, maxX = 1 + margin
        let minY = -margin, maxY = layout.height + margin
        func clampAxis(_ v: Double, _ half: Double, _ lo: Double, _ hi: Double) -> Double {
            if hi - lo <= half * 2 { return (lo + hi) / 2 } // content smaller than view: centre it
            return min(max(v, lo + half), hi - half)
        }
        c.center = Vec2(clampAxis(c.center.x, halfVisible.x, minX, maxX), clampAxis(c.center.y, halfVisible.y, minY, maxY))
        return c
    }

    /// Zoom by `factor` keeping the layout point under `anchor` (screen) fixed.
    public func zoom(_ camera: SeatMapCamera, by factor: Double, anchor: Vec2, size: Vec2) -> SeatMapCamera {
        let before = viewport(camera: camera, size: size)
        let anchorLayout = before.toLayout(anchor)
        var c = camera
        c.zoom = min(max(camera.zoom * factor, 1), maxZoom(for: size))
        let newScale = fitScale(for: size) * c.zoom
        // Solve for centre so that anchorLayout maps to anchor again.
        c.center = anchorLayout - (anchor - size * 0.5) * (1 / newScale)
        return clamp(c, size: size)
    }

    /// Pan by a screen-space translation.
    public func pan(_ camera: SeatMapCamera, by translation: Vec2, size: Vec2) -> SeatMapCamera {
        let scale = fitScale(for: size) * camera.zoom
        return clamp(SeatMapCamera(zoom: camera.zoom, center: camera.center - translation * (1 / scale)), size: size)
    }

    /// Camera that centres on a seat at a zoom where seats are comfortably tappable.
    public func focus(on seat: Seat, size: Vec2) -> SeatMapCamera {
        let targetZoom = min(maxZoom(for: size), max(1, (Self.minimumTouchTarget * 1.1) / (seat.width * fitScale(for: size))))
        return clamp(SeatMapCamera(zoom: targetZoom, center: Vec2(seat.x, seat.y)), size: size)
    }

    /// On-screen size of the smallest seat at this camera, in points.
    public func seatPointSize(camera: SeatMapCamera, size: Vec2) -> Double {
        (layout.seats.map(\.width).min() ?? 0.04) * fitScale(for: size) * camera.zoom
    }

    /// True when the whole layout is visible (used to hide the mini-map).
    public func isOverview(_ camera: SeatMapCamera) -> Bool { camera.zoom < 1.15 }

    /// Visible layout rect at this camera, for the orientation mini-map.
    public func visibleRect(camera: SeatMapCamera, size: Vec2) -> (origin: Vec2, size: Vec2) {
        let scale = fitScale(for: size) * camera.zoom
        let s = Vec2(size.x / scale, size.y / scale)
        return (camera.center - s * 0.5, s)
    }

    // MARK: Hit testing

    /// Maps a touch to a seat. A seat whose footprint contains the point wins;
    /// otherwise the nearest seat centre within half a minimum touch target
    /// (in screen points) is chosen, which makes small seats easier to hit
    /// without ever reaching across an aisle to a distant seat.
    public func hitTest(screenPoint: Vec2, camera: SeatMapCamera, size: Vec2) -> Seat? {
        let vp = viewport(camera: camera, size: size)
        let p = vp.toLayout(screenPoint)
        let lp = AuditoriumLayout.Point(x: p.x, y: p.y)
        let toleranceLayout = (Self.minimumTouchTarget / 2) / vp.scale
        let candidates = seatIndices(near: p, radius: toleranceLayout)

        var containing: (index: Int, distance: Double)?
        var nearest: (index: Int, distance: Double)?
        for i in candidates {
            let s = layout.seats[i]
            let d = (Vec2(s.x, s.y) - p).length
            if s.contains(lp) {
                if containing.map({ d < $0.distance }) ?? true { containing = (i, d) }
            } else if d <= min(toleranceLayout, s.width * 0.85) {
                // Snap only within ~one seat of the centre, so a touch never jumps an aisle.
                if nearest.map({ d < $0.distance }) ?? true { nearest = (i, d) }
            }
        }
        let best = containing ?? nearest
        return best.map { layout.seats[$0.index] }
    }

    private func seatIndices(near p: Vec2, radius: Double) -> [Int] {
        let x0 = Int(((p.x - radius) / cellSize).rounded(.down)), x1 = Int(((p.x + radius) / cellSize).rounded(.down))
        let y0 = Int(((p.y - radius) / cellSize).rounded(.down)), y1 = Int(((p.y + radius) / cellSize).rounded(.down))
        var out = Set<Int>()
        if x1 - x0 > 50 || y1 - y0 > 50 { return Array(layout.seats.indices) }
        for gx in x0...x1 { for gy in y0...y1 { if let v = grid[GridKey(x: gx, y: gy)] { out.formUnion(v) } } }
        return Array(out)
    }

    // MARK: Screen drawing helpers

    /// Points along the screen curve in layout units (bows away from the audience).
    public func screenCurve(segments: Int = 24) -> [Vec2] {
        let s = layout.screen
        let sag = s.curvature * s.width
        return (0...segments).map { i in
            let t = Double(i) / Double(segments) * 2 - 1 // -1...1
            let along = t * s.width / 2
            let bow = sag * (1 - t * t) // parabola, max at centre
            switch s.edge {
            case .top: return Vec2(s.center.x + along, s.center.y - bow)
            case .bottom: return Vec2(s.center.x + along, s.center.y + bow)
            case .left: return Vec2(s.center.x - bow, s.center.y + along)
            case .right: return Vec2(s.center.x + bow, s.center.y + along)
            }
        }
    }

    /// Where to draw row labels: just outside the first and last seat of each row.
    public func rowLabelPositions() -> [(row: AuditoriumLayout.Row, left: Vec2, right: Vec2)] {
        let byRow = Dictionary(grouping: layout.seats, by: \.rowId)
        return layout.rows.sorted { $0.order < $1.order }.compactMap { row in
            guard let seats = byRow[row.id], let first = seats.min(by: { $0.x < $1.x }), let last = seats.max(by: { $0.x < $1.x }) else { return nil }
            return (row, Vec2(first.x - first.width * 1.1, first.y), Vec2(last.x + last.width * 1.1, last.y))
        }
    }
}
