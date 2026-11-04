import SwiftUI
import CinemaCore
import CinemaDesign

/// Map plus orientation aids: mini-map with screen direction while zoomed,
/// zoom controls and a reset-view button.
public struct SeatMapContainer: View {
    @Bindable var model: SeatSelectionModel
    let formatters: Formatters
    let onToggle: (Seat, SeatSelectionModel.ToggleResult) -> Void
    var onZoom: (String) -> Void = { _ in }
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var size: CGSize = .zero

    public init(model: SeatSelectionModel, formatters: Formatters, onToggle: @escaping (Seat, SeatSelectionModel.ToggleResult) -> Void = { _, _ in }, onZoom: @escaping (String) -> Void = { _ in }) {
        self.model = model; self.formatters = formatters; self.onToggle = onToggle; self.onZoom = onZoom
    }

    public var body: some View {
        SeatMapView(model: model, formatters: formatters, onToggle: onToggle, onZoom: onZoom)
            .onGeometryChange(for: CGSize.self) { $0.size } action: { size = $0 }
            .overlay(alignment: .topLeading) {
                if !model.geometry.isOverview(model.camera) {
                    MiniMap(model: model, viewSize: size)
                        .padding(12)
                        .transition(.opacity.combined(with: .scale(scale: 0.9, anchor: .topLeading)))
                }
            }
            .overlay(alignment: .bottomTrailing) { controls.padding(12) }
            .animation(reduceMotion ? nil : .smooth(duration: 0.25), value: model.geometry.isOverview(model.camera))
    }

    private var controls: some View {
        VStack(spacing: 0) {
            control("plus.magnifyingglass", "Zoom in") { zoom(1.6) }
            Divider().frame(width: 28)
            control("minus.magnifyingglass", "Zoom out") { zoom(1 / 1.6) }
            if !model.geometry.isOverview(model.camera) {
                Divider().frame(width: 28)
                control("arrow.up.left.and.down.right.magnifyingglass", "Show whole auditorium") {
                    withAnimation(reduceMotion ? nil : .smooth) { model.camera = model.geometry.fitCamera }
                }
            }
        }
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func control(_ icon: String, _ label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: icon).font(.body.weight(.semibold)).frame(width: 44, height: 44)
        }
        .foregroundStyle(palette.textPrimary)
        .accessibilityLabel(label)
    }

    private func zoom(_ factor: Double) {
        let s = Vec2(Double(size.width), Double(size.height))
        withAnimation(reduceMotion ? nil : .smooth(duration: 0.3)) {
            model.camera = model.geometry.zoom(model.camera, by: factor, anchor: s * 0.5, size: s)
        }
    }
}

/// Small overview that always shows where the screen is and which part of the
/// auditorium is visible, so customers never lose orientation when zoomed in.
struct MiniMap: View {
    let model: SeatSelectionModel
    let viewSize: CGSize
    @Environment(\.palette) private var palette

    var body: some View {
        let width: CGFloat = 108
        let layout = model.layout
        let height = width / layout.aspectRatio
        Canvas { ctx, size in
            let k = size.width
            var screen = Path()
            let curve = model.geometry.screenCurve(segments: 10)
            screen.move(to: CGPoint(x: curve[0].x * k, y: curve[0].y * k))
            for p in curve.dropFirst() { screen.addLine(to: CGPoint(x: p.x * k, y: p.y * k)) }
            ctx.stroke(screen, with: .color(palette.screen), lineWidth: 2)
            for seat in layout.seats {
                let state = model.presentation(for: seat).state
                let r = CGRect(x: (seat.x - seat.width / 2) * k, y: (seat.y - seat.height / 2) * k, width: seat.width * k, height: seat.height * k)
                ctx.fill(Path(r), with: .color(state == .selected ? palette.seatSelected : state == .available ? palette.seatAvailableBorder.opacity(0.6) : palette.seatSold))
            }
            let visible = model.geometry.visibleRect(camera: model.camera, size: Vec2(Double(viewSize.width), Double(viewSize.height)))
            let vr = CGRect(x: visible.origin.x * k, y: visible.origin.y * k, width: visible.size.x * k, height: visible.size.y * k)
            ctx.stroke(Path(roundedRect: vr, cornerRadius: 3), with: .color(palette.focus), lineWidth: 1.5)
        }
        .frame(width: width, height: height)
        .padding(8)
        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(alignment: .top) {
            Text("SCREEN").font(.system(size: 8, weight: .bold)).tracking(2).foregroundStyle(palette.textMuted).offset(y: -2)
        }
        .accessibilityHidden(true)
    }
}

/// Seat key built from the operator's categories plus seat states, using the
/// same presentation rules as the map so they never disagree.
public struct SeatLegend: View {
    let model: SeatSelectionModel
    let formatters: Formatters
    @Environment(\.palette) private var palette
    @Environment(\.colorScheme) private var colorScheme

    public init(model: SeatSelectionModel, formatters: Formatters) { self.model = model; self.formatters = formatters }

    public var body: some View {
        let kinds = Set(model.layout.seats.map(\.type))
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 16) {
                item(fill: palette.seatSelected, stroke: nil, symbol: "checkmark", ink: palette.seatSelectedText, "Selected")
                item(fill: palette.seatSold, stroke: nil, symbol: "xmark", ink: palette.textMuted, "Taken")
                ForEach(model.categoriesInLayout) { c in
                    let colours = c.colours.map { colorScheme == .dark ? $0.dark : $0.light }
                    item(fill: colours.map { Color(hex: $0.fill) } ?? palette.seatAvailable,
                         stroke: colours.map { Color(hex: $0.accent) } ?? (c.id == "standard" ? palette.seatAvailableBorder : palette.seatPremium),
                         symbol: c.safeIcon, ink: palette.textSecondary, label(for: c))
                }
                if kinds.contains(.wheelchair) {
                    item(fill: palette.seatAccessible.opacity(0.22), stroke: palette.seatAccessible, symbol: "figure.roll", ink: palette.seatAccessible, "Wheelchair space")
                }
                if kinds.contains(.companion) {
                    item(fill: palette.seatCompanion.opacity(0.22), stroke: palette.seatCompanion, symbol: "person.2.fill", ink: palette.seatCompanion, "Companion")
                }
                if model.layout.seats.contains(where: { $0.restrictedView != nil }) {
                    item(fill: palette.seatAvailable, stroke: palette.seatRestricted, symbol: "eye.trianglebadge.exclamationmark", ink: palette.seatRestricted, "Restricted view")
                }
            }
            .padding(.horizontal, 20)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Seat key")
    }

    /// "Luxe Pod · £24.95" using the default ticket type.
    private func label(for c: SeatCategory) -> String {
        guard let t = model.screening.pricing.defaultTicketType, let p = model.screening.pricing.price(for: t, category: c.id) else { return c.label }
        return "\(c.label) · \(formatters.money(p))"
    }

    private func item(fill: Color, stroke: Color?, symbol: String?, ink: Color = .clear, _ label: String) -> some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 5, style: .continuous)
                .fill(fill)
                .overlay { if let stroke { RoundedRectangle(cornerRadius: 5, style: .continuous).strokeBorder(stroke, lineWidth: 1.5) } }
                .overlay { if let symbol { Image(systemName: symbol).font(.system(size: 9, weight: .bold)).foregroundStyle(ink) } }
                .frame(width: 18, height: 18)
            Text(label).font(.caption).foregroundStyle(palette.textSecondary)
        }
    }
}

/// Structured, non-visual alternative to the map: section → row → seat using
/// native controls. Works fully with VoiceOver, Switch Control and keyboards.
public struct SeatListView: View {
    @Bindable var model: SeatSelectionModel
    let formatters: Formatters
    @State private var showUnavailable = false
    @Environment(\.palette) private var palette

    public init(model: SeatSelectionModel, formatters: Formatters) { self.model = model; self.formatters = formatters }

    public var body: some View {
        List {
            Section {
                Toggle("Show unavailable seats", isOn: $showUnavailable)
            } footer: {
                Text("The screen is at the front, in front of row \(model.accessibleRows.first?.label ?? "A"). Rows are listed from the front.")
            }
            ForEach(sections, id: \.name) { section in
                Section(section.name) {
                    ForEach(section.rows) { row in
                        DisclosureGroup {
                            ForEach(row.seats.filter { showUnavailable || model.presentation(for: $0).isSelectable }) { seat in
                                seatRow(seat)
                            }
                        } label: {
                            let free = row.seats.filter { model.presentation(for: $0).state == .available }.count
                            Text("Row \(row.label)").font(.headline)
                            Text("\(free) available").font(.subheadline).foregroundStyle(palette.textMuted)
                        }
                    }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(palette.background)
    }

    private var sections: [(name: String, rows: [SeatSelectionModel.RowGroup])] {
        var order: [String] = []
        var map: [String: [SeatSelectionModel.RowGroup]] = [:]
        for r in model.accessibleRows {
            if map[r.section] == nil { order.append(r.section) }
            map[r.section, default: []].append(r)
        }
        return order.map { ($0, map[$0]!) }
    }

    private func seatRow(_ seat: Seat) -> some View {
        let p = model.presentation(for: seat)
        return Button {
            model.toggle(seat.id)
            if let m = model.message?.text { AccessibilityNotification.Announcement(m).post() }
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(seat.type == .wheelchair ? "Wheelchair space" : "Seat \(seat.label)").foregroundStyle(palette.textPrimary)
                    Text([p.seatCategory.label, seat.restrictedView].compactMap { $0 }.joined(separator: " · "))
                        .font(.footnote).foregroundStyle(palette.textMuted)
                }
                Spacer()
                if let price = model.estimatedPrice(for: seat), p.isSelectable {
                    Text(formatters.money(price)).foregroundStyle(palette.textSecondary)
                }
                Image(systemName: p.state == .selected ? "checkmark.circle.fill" : p.isSelectable ? "circle" : "xmark.circle")
                    .foregroundStyle(p.state == .selected ? palette.selected : palette.textMuted)
                    .imageScale(.large)
            }
            .frame(minHeight: 44)
        }
        .disabled(!p.isSelectable)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(model.accessibilityLabel(for: seat, formatters: formatters))
        .accessibilityAddTraits(p.state == .selected ? [.isButton, .isSelected] : .isButton)
    }
}
