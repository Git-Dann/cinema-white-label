import SwiftUI
import CinemaCore
import CinemaDesign

/// Interactive, data-driven auditorium map.
///
/// Rendering: one `Canvas` draws the screen, features, row labels and every
/// seat from normalised geometry — no per-seat views, so 400+ seat auditoriums
/// stay smooth. Interaction: a single tap/pinch/drag layer maps touches to
/// seats with `SeatMapGeometry.hitTest`. Accessibility: `accessibilityChildren`
/// exposes one element per seat with a full spoken description and actions.
public struct SeatMapView: View {
    @Bindable var model: SeatSelectionModel
    let formatters: Formatters
    let onToggle: (Seat, SeatSelectionModel.ToggleResult) -> Void

    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.accessibilityDifferentiateWithoutColor) private var differentiateWithoutColor

    /// Camera at the start of the current gesture.
    @State private var gestureStart: SeatMapCamera?
    @State private var magnifyAnchor: CGPoint?

    public init(model: SeatSelectionModel, formatters: Formatters, onToggle: @escaping (Seat, SeatSelectionModel.ToggleResult) -> Void = { _, _ in }) {
        self.model = model
        self.formatters = formatters
        self.onToggle = onToggle
    }

    public var body: some View {
        GeometryReader { geo in
            let size = Vec2(Double(geo.size.width), Double(geo.size.height))
            let geometry = model.geometry
            let camera = geometry.clamp(model.camera, size: size)
            let viewport = geometry.viewport(camera: camera, size: size)

            TimelineView(.animation(minimumInterval: 1 / 60, paused: !isAnimatingSelection)) { timeline in
                Canvas { ctx, _ in
                    draw(in: &ctx, viewport: viewport, now: timeline.date)
                } symbols: {
                    ForEach(symbolNames, id: \.self) { name in
                        Image(systemName: name).font(.system(size: 64, weight: .bold)).foregroundStyle(.white).tag(name)
                    }
                }
            }
            .contentShape(Rectangle())
            .gesture(tapGesture(size: size))
            .simultaneousGesture(magnifyGesture(size: size))
            .simultaneousGesture(dragGesture(size: size))
            .accessibilityElement(children: .contain)
            .accessibilityLabel("Seat map, \(model.layout.name). The screen is at the \(screenEdgeDescription).")
            .accessibilityChildren {
                // Accessibility-only elements; not rendered.
                ForEach(model.layout.seats) { seat in
                    let p = viewport.toScreen(Vec2(seat.x, seat.y))
                    let w = max(seat.width * viewport.scale, 12), h = max(seat.height * viewport.scale, 12)
                    Rectangle()
                        .frame(width: w, height: h)
                        .position(x: p.x, y: p.y)
                        .accessibilityLabel(model.accessibilityLabel(for: seat, formatters: formatters))
                        .accessibilityHint(SeatAccessibility.hint(presentation: model.presentation(for: seat)) ?? "")
                        .accessibilityAddTraits(model.presentation(for: seat).isSelectable ? .isButton : [])
                        .accessibilityAddTraits(model.isSelected(seat.id) ? .isSelected : [])
                        .accessibilityAction { toggle(seat) }
                }
            }
            .onChange(of: geo.size) { _, _ in
                // Keep the same layout point centred when the display changes (iPhone Duo).
                model.camera = geometry.clamp(model.camera, size: size)
            }
        }
        .background(palette.background)
        .clipped()
    }

    // MARK: Gestures

    private func tapGesture(size: Vec2) -> some Gesture {
        SpatialTapGesture()
            .onEnded { value in
                let point = Vec2(Double(value.location.x), Double(value.location.y))
                let geometry = model.geometry
                let camera = geometry.clamp(model.camera, size: size)
                // At overview scale seats are smaller than a comfortable touch target:
                // the first tap zooms into that area, the next tap selects precisely.
                if geometry.seatPointSize(camera: camera, size: size) < 22 {
                    let target = geometry.zoom(camera, by: 2.4, anchor: point, size: size)
                    withAnimation(reduceMotion ? nil : .smooth(duration: 0.35)) { model.camera = target }
                    return
                }
                guard let seat = geometry.hitTest(screenPoint: point, camera: camera, size: size) else { return }
                toggle(seat)
            }
    }

    private func magnifyGesture(size: Vec2) -> some Gesture {
        MagnifyGesture()
            .onChanged { value in
                let start = gestureStart ?? model.camera
                if gestureStart == nil { gestureStart = start }
                let anchor = Vec2(Double(value.startLocation.x), Double(value.startLocation.y))
                model.camera = model.geometry.zoom(start, by: Double(value.magnification), anchor: anchor, size: size)
            }
            .onEnded { _ in gestureStart = nil }
    }

    private func dragGesture(size: Vec2) -> some Gesture {
        DragGesture(minimumDistance: 8)
            .onChanged { value in
                let start = gestureStart ?? model.camera
                if gestureStart == nil { gestureStart = start }
                model.camera = model.geometry.pan(start, by: Vec2(Double(value.translation.width), Double(value.translation.height)), size: size)
            }
            .onEnded { _ in gestureStart = nil }
    }

    private func toggle(_ seat: Seat) {
        let result = model.toggle(seat.id)
        onToggle(seat, result)
        if let message = model.message?.text {
            AccessibilityNotification.Announcement(message).post()
        }
    }

    // MARK: Drawing

    private var isAnimatingSelection: Bool {
        guard !reduceMotion, let last = model.lastToggled else { return false }
        return Date().timeIntervalSince(last.at) < 0.3
    }

    private var symbolNames: [String] {
        ["checkmark", "xmark", "minus", "exclamationmark", "figure.roll", "person.2.fill", "eye.trianglebadge.exclamationmark"]
    }

    private var screenEdgeDescription: String {
        switch model.layout.screen.edge { case .top: "top"; case .bottom: "bottom"; case .left: "left"; case .right: "right" }
    }

    private func draw(in ctx: inout GraphicsContext, viewport vp: SeatMapViewport, now: Date) {
        let geometry = model.geometry
        let scale = vp.scale
        func pt(_ v: Vec2) -> CGPoint { let s = vp.toScreen(v); return CGPoint(x: s.x, y: s.y) }

        // Screen: curved line with a soft projection glow towards the seats.
        let curve = geometry.screenCurve()
        var screenPath = Path()
        screenPath.move(to: pt(curve[0]))
        for p in curve.dropFirst() { screenPath.addLine(to: pt(p)) }
        let firstRowY = (model.layout.seats.map(\.y).min() ?? 0.2)
        var glow = Path()
        glow.move(to: pt(curve[0]))
        for p in curve.dropFirst() { glow.addLine(to: pt(p)) }
        let s = model.layout.screen
        glow.addLine(to: pt(Vec2(s.center.x + s.width / 2 + 0.04, firstRowY - 0.02)))
        glow.addLine(to: pt(Vec2(s.center.x - s.width / 2 - 0.04, firstRowY - 0.02)))
        glow.closeSubpath()
        ctx.fill(glow, with: .linearGradient(Gradient(colors: [palette.screen.opacity(0.16), palette.screen.opacity(0)]),
                                             startPoint: pt(Vec2(s.center.x, s.center.y)), endPoint: pt(Vec2(s.center.x, firstRowY))))
        ctx.stroke(screenPath, with: .color(palette.screen), style: StrokeStyle(lineWidth: max(3, 0.006 * scale), lineCap: .round))
        let labelSize = min(max(11, 0.022 * scale), 22)
        ctx.draw(Text(s.label).font(.system(size: labelSize, weight: .semibold)).tracking(labelSize * 0.35).foregroundStyle(palette.textMuted),
                 at: pt(Vec2(s.center.x, s.center.y + 0.035)), anchor: .center)

        // Physical features: entrances, exits, walkways (subtle dashed outlines).
        for f in model.layout.features where f.kind != .aisle {
            let r = CGRect(x: pt(Vec2(f.x, f.y)).x, y: pt(Vec2(f.x, f.y)).y, width: f.width * scale, height: f.height * scale)
            ctx.stroke(Path(roundedRect: r, cornerRadius: 4), with: .color(palette.divider), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
            if let label = f.label, r.width > 30 {
                ctx.draw(Text(label).font(.system(size: min(max(9, 0.016 * scale), 14))).foregroundStyle(palette.textMuted), at: CGPoint(x: r.midX, y: r.midY))
            }
        }

        // Row labels on both sides so orientation is clear while zoomed.
        let rowFont = Font.system(size: min(max(10, 0.024 * scale), 20), weight: .semibold)
        for row in geometry.rowLabelPositions() {
            ctx.draw(Text(row.row.label).font(rowFont).foregroundStyle(palette.textMuted), at: pt(row.left))
            ctx.draw(Text(row.row.label).font(rowFont).foregroundStyle(palette.textMuted), at: pt(row.right))
        }

        // Seats.
        let showLabels = (model.layout.seats.map(\.width).min() ?? 0) * scale > 26
        for seat in model.layout.seats {
            let p = model.presentation(for: seat)
            var pop: CGFloat = 1
            if !reduceMotion, let last = model.lastToggled, last.id == seat.id || (seat.groupId != nil && model.seat(last.id)?.groupId == seat.groupId) {
                let t = now.timeIntervalSince(last.at)
                if t < 0.3 { pop = 1 + 0.18 * CGFloat(sin(t / 0.3 * .pi)) }
            }
            let w = seat.width * scale * pop, h = seat.height * scale * pop
            var c = ctx
            c.translateBy(x: pt(Vec2(seat.x, seat.y)).x, y: pt(Vec2(seat.x, seat.y)).y)
            c.rotate(by: .degrees(seat.rotation))
            let rect = CGRect(x: -w / 2, y: -h / 2, width: w, height: h)
            let shape = seatShape(rect: rect, category: p.category)
            let (fill, stroke, ink) = colours(for: p)
            c.fill(shape, with: .color(fill))
            if let stroke { c.stroke(shape, with: .color(stroke), lineWidth: max(1, w * 0.06)) }
            if p.category == .premium || p.category == .recliner, p.state == .available {
                // Premium band across the seat back: shape cue in addition to colour.
                let band = CGRect(x: rect.minX + w * 0.15, y: rect.minY + h * 0.12, width: w * 0.7, height: max(1.5, h * 0.12))
                c.fill(Path(roundedRect: band, cornerRadius: band.height / 2), with: .color(palette.seatPremium))
            }
            if let symbol = p.symbolName, let resolved = c.resolveSymbol(id: symbol) {
                let side = min(w, h) * 0.55
                c.drawLayer { layer in
                    layer.addFilter(.colorMultiply(ink))
                    layer.draw(resolved, in: CGRect(x: -side / 2, y: -side / 2, width: side, height: side))
                }
            } else if showLabels {
                c.draw(Text(seat.label).font(.system(size: min(h * 0.38, 14), weight: .semibold)).foregroundStyle(ink), at: .zero)
            }
            if differentiateWithoutColor, p.state == .sold || p.state == .heldByOthers {
                var hatch = Path()
                hatch.move(to: CGPoint(x: rect.minX, y: rect.maxY)); hatch.addLine(to: CGPoint(x: rect.maxX, y: rect.minY))
                c.stroke(hatch, with: .color(palette.textMuted), lineWidth: 1)
            }
        }
    }

    private func seatShape(rect: CGRect, category: SeatPresentation.Category) -> Path {
        switch category {
        case .wheelchair:
            return Path(roundedRect: rect, cornerRadius: rect.height * 0.5)
        case .sofa, .recliner:
            return Path(roundedRect: rect, cornerRadius: rect.height * 0.32)
        default:
            // Seat silhouette: rounded back with slightly squarer front edge.
            return Path(roundedRect: rect, cornerSize: CGSize(width: rect.width * 0.28, height: rect.height * 0.28), style: .continuous)
        }
    }

    private func colours(for p: SeatPresentation) -> (fill: Color, stroke: Color?, ink: Color) {
        switch p.state {
        case .selected: return (palette.seatSelected, nil, palette.seatSelectedText)
        case .conflict: return (palette.error, nil, palette.background)
        case .sold: return (palette.seatSold, nil, palette.textMuted)
        case .heldByOthers: return (palette.seatSold, palette.seatHeld, palette.seatHeld)
        case .blocked: return (palette.seatBlocked, nil, palette.textMuted)
        case .available:
            switch p.category {
            case .wheelchair: return (palette.seatAccessible.opacity(0.22), palette.seatAccessible, palette.seatAccessible)
            case .companion: return (palette.seatCompanion.opacity(0.22), palette.seatCompanion, palette.seatCompanion)
            case .premium, .recliner, .sofa: return (palette.seatAvailable, palette.seatPremium, palette.textPrimary)
            case .standard: return (palette.seatAvailable, p.restricted ? palette.seatRestricted : palette.seatAvailableBorder, palette.textSecondary)
            }
        }
    }
}
