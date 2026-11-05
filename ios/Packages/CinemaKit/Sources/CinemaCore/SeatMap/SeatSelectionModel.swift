import Foundation
import Observation

/// Customer seat selection for one screening.
///
/// Selection is local and provisional. Nothing is reserved until the booking
/// flow creates a server-side hold, and the server is authoritative. When live
/// availability shows a selected seat was taken, the seat is flagged as a
/// conflict (never silently removed) so the UI can explain and offer recovery.
@MainActor
@Observable
public final class SeatSelectionModel {
    public let screening: ScreeningDetail
    public let geometry: SeatMapGeometry
    public let maxTickets: Int

    public private(set) var availability: [String: SeatAvailability]
    public private(set) var availabilityVersion: Int
    public private(set) var selectedSeatIds: [String] = []
    public private(set) var conflicts: Set<String> = []
    /// Latest feedback for the selection summary / VoiceOver announcement.
    public private(set) var message: Message?
    /// Device-independent camera; survives layout changes (iPhone Duo).
    public var camera: SeatMapCamera
    /// Seat whose state changed most recently, for a brief selection animation.
    public private(set) var lastToggled: (id: String, at: Date)?

    public struct Message: Sendable, Hashable {
        public enum Kind: Sendable { case info, warning, error }
        public let kind: Kind
        public let text: String
        public let seatIds: [String]
    }

    /// Operator seat categories keyed by price category id.
    public let categories: [String: SeatCategory]
    public let rulesEngine: SeatRulesEngine
    /// Tap interpretation state (double-tap detection) for the map.
    public var tapInterpreter = SeatTapInterpreter()

    private let seatsById: [String: Seat]
    private let rowLabels: [String: String]
    private let groups: [String: [String]]

    public init(screening: ScreeningDetail, availability: AvailabilitySnapshot, maxTickets: Int) {
        self.screening = screening
        self.geometry = SeatMapGeometry(layout: screening.layout)
        let rules = screening.seatRules ?? SeatRules(maxTickets: maxTickets)
        self.maxTickets = min(maxTickets, rules.maxTickets)
        self.rulesEngine = SeatRulesEngine(layout: screening.layout, rules: SeatRules(maxTickets: min(maxTickets, rules.maxTickets), orphanSeatPolicy: rules.orphanSeatPolicy, companionPolicy: rules.companionPolicy))
        self.categories = Dictionary((screening.seatCategories ?? []).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        self.availability = availability.seats
        self.availabilityVersion = availability.version
        self.camera = SeatMapGeometry(layout: screening.layout).fitCamera
        self.seatsById = Dictionary(uniqueKeysWithValues: screening.layout.seats.map { ($0.id, $0) })
        self.rowLabels = Dictionary(uniqueKeysWithValues: screening.layout.rows.map { ($0.id, $0.label) })
        var g: [String: [String]] = [:]
        for s in screening.layout.seats { if let gid = s.groupId { g[gid, default: []].append(s.id) } }
        self.groups = g
        if let hold = availability.yourHold {
            // Restore the customer's own active hold (e.g. after the app was relaunched).
            selectedSeatIds = hold.seatIds.filter { seatsById[$0] != nil }
        }
    }

    // MARK: Queries

    public var layout: AuditoriumLayout { screening.layout }
    public func seat(_ id: String) -> Seat? { seatsById[id] }
    public func rowLabel(for seat: Seat) -> String { rowLabels[seat.rowId] ?? seat.rowId }
    public func isSelected(_ id: String) -> Bool { selectedSeatIds.contains(id) }

    public func presentation(for seat: Seat) -> SeatPresentation {
        let sel = selectedSeatIds.contains(seat.id)
        // A seat in our own selection that shows as held is our hold, not a conflict.
        let avail = sel && availability[seat.id] == .held ? .available : availability[seat.id]
        return SeatPresentation(seat: seat, availability: avail, isSelected: sel, isConflict: conflicts.contains(seat.id), seatCategory: category(for: seat))
    }

    /// Price in minor units for the default ticket type, used for estimates and labels.
    public func estimatedPrice(for seat: Seat) -> Int? {
        guard let t = screening.pricing.defaultTicketType else { return nil }
        return screening.pricing.price(for: t, category: seat.priceCategory)
    }

    public var selectedSeats: [Seat] { selectedSeatIds.compactMap { seatsById[$0] } }

    /// Estimated subtotal with default ticket types plus fees. Final price comes from the server quote.
    public var estimatedTotalMinor: Int {
        selectedSeats.compactMap { estimatedPrice(for: $0) }.reduce(0, +) + screening.pricing.bookingFeePerTicketMinor * selectedSeatIds.count
    }

    public func category(for seat: Seat) -> SeatCategory { categories[seat.priceCategory] ?? .fallback(for: seat.priceCategory, kind: seat.type) }

    /// Categories present in this auditorium, in operator order (for the legend).
    public var categoriesInLayout: [SeatCategory] {
        var seen = Set<String>()
        return layout.seats.compactMap { s in seen.insert(s.priceCategory).inserted ? category(for: s) : nil }.sorted { $0.sortOrder < $1.sortOrder }
    }

    /// Seats this customer cannot take right now.
    public var unavailableSeatIds: Set<String> {
        Set(availability.compactMap { id, state in state == .available || selectedSeatIds.contains(id) ? nil : id })
    }

    /// Live rule evaluation of the current selection (instant feedback; server re-checks).
    public var validation: SeatRulesEngine.Result {
        rulesEngine.evaluate(selected: selectedSeatIds, unavailable: unavailableSeatIds)
    }

    /// Why Continue is disabled, if it is.
    public var blockingReason: String? {
        if selectedSeatIds.isEmpty { return nil }
        if !conflicts.isEmpty { return message?.text ?? "Some seats are no longer available." }
        return validation.errors.first?.message
    }

    public var canContinue: Bool { !selectedSeatIds.isEmpty && conflicts.isEmpty && validation.isValid }

    /// "F8, F9"
    public var selectionSummary: String {
        selectedSeats.sorted { ($0.rowId, $0.order) < ($1.rowId, $1.order) }.map { "\(rowLabel(for: $0))\($0.label)" }.joined(separator: ", ")
    }

    public func accessibilityLabel(for seat: Seat, formatters: Formatters) -> String {
        SeatAccessibility.label(seat: seat, rowLabel: rowLabel(for: seat), presentation: presentation(for: seat), price: estimatedPrice(for: seat).map(formatters.money))
    }

    // MARK: Mutations

    public enum ToggleResult: Equatable, Sendable {
        case selected([String])
        case deselected([String])
        case rejected(String)
    }

    @discardableResult
    public func toggle(_ seatId: String, now: Date = Date()) -> ToggleResult {
        guard let seat = seatsById[seatId] else { return .rejected("Unknown seat") }
        let members = seat.groupId.flatMap { groups[$0] } ?? [seatId]

        if conflicts.contains(seatId) || selectedSeatIds.contains(seatId) {
            selectedSeatIds.removeAll { members.contains($0) }
            conflicts.subtract(members)
            lastToggled = (seatId, now)
            message = members.count > 1 ? Message(kind: .info, text: "Both places removed from your selection.", seatIds: members) : nil
            return .deselected(members)
        }

        let p = presentation(for: seat)
        guard p.state == .available else {
            let text = "\(rowLabel(for: seat))\(seat.label) is \(SeatAccessibility.stateName(p.state))."
            message = Message(kind: .error, text: text, seatIds: [seatId])
            return .rejected(text)
        }
        let unavailableMember = members.first { $0 != seatId && presentation(for: seatsById[$0]!).state != .available }
        if let other = unavailableMember, let s = seatsById[other] {
            let text = "These seats are sold together and \(rowLabel(for: s))\(s.label) is already taken."
            message = Message(kind: .error, text: text, seatIds: members)
            return .rejected(text)
        }
        if selectedSeatIds.count + members.count > maxTickets {
            let text = "You can book up to \(maxTickets) seats at once."
            message = Message(kind: .error, text: text, seatIds: [seatId])
            return .rejected(text)
        }

        selectedSeatIds.append(contentsOf: members.filter { !selectedSeatIds.contains($0) })
        lastToggled = (seatId, now)
        if members.count > 1 {
            let what = seat.type == .vipBed ? "VIP beds are" : "Sofa seats are"
            message = Message(kind: .info, text: "\(what) sold in pairs, so both places are selected.", seatIds: members)
        } else if seat.type == .wheelchair {
            message = Message(kind: .info, text: "This is a wheelchair space with no fixed seat.", seatIds: members)
        } else if seat.type == .companion, rulesEngine.rules.companionPolicy == .requireWheelchair {
            message = Message(kind: .warning, text: "Companion seats are booked together with the wheelchair space next to them.", seatIds: members)
        } else if seat.type == .companion, rulesEngine.rules.companionPolicy == .warn {
            message = Message(kind: .info, text: "Companion seat next to a wheelchair space.", seatIds: members)
        } else if let r = seat.restrictedView {
            message = Message(kind: .warning, text: "\(r).", seatIds: members)
        } else {
            message = nil
        }
        return .selected(members)
    }

    public func clearSelection() {
        selectedSeatIds = []
        conflicts = []
        message = nil
    }

    /// Replaces availability with a fresh snapshot (polling fallback).
    public func apply(snapshot: AvailabilitySnapshot, ownHoldSeatIds: Set<String> = []) {
        availability = snapshot.seats
        availabilityVersion = snapshot.version
        recomputeConflicts(ownHoldSeatIds: ownHoldSeatIds)
    }

    /// Applies an incremental change from the live stream.
    public func apply(change: AvailabilityChange, ownHoldSeatIds: Set<String> = []) {
        guard change.screeningId == screening.id else { return }
        for c in change.changes { availability[c.seatId] = c.state }
        recomputeConflicts(ownHoldSeatIds: ownHoldSeatIds)
    }

    /// Marks seats the server reported as unavailable (e.g. hold request 409).
    public func markConflicts(_ seatIds: [String]) {
        let relevant = seatIds.filter { selectedSeatIds.contains($0) }
        conflicts.formUnion(relevant)
        for id in seatIds where availability[id] == .available { availability[id] = .held }
        announceConflicts()
    }

    private func recomputeConflicts(ownHoldSeatIds: Set<String>) {
        let lost = selectedSeatIds.filter { id in
            guard let state = availability[id] else { return false }
            if state == .available { return false }
            return !(state == .held && ownHoldSeatIds.contains(id))
        }
        let before = conflicts
        conflicts = Set(lost)
        if conflicts != before, !conflicts.isEmpty { announceConflicts() }
    }

    private func announceConflicts() {
        let names = conflicts.compactMap { seatsById[$0] }.sorted { $0.order < $1.order }.map { "\(rowLabel(for: $0))\($0.label)" }
        guard !names.isEmpty else { return }
        let list = names.joined(separator: ", ")
        message = Message(kind: .error, text: names.count == 1 ? "\(list) has just been taken. Remove it and choose another seat." : "\(list) have just been taken. Remove them and choose other seats.", seatIds: Array(conflicts))
    }

    /// Removes all conflicted seats (the recovery action).
    public func removeConflicts() {
        selectedSeatIds.removeAll { conflicts.contains($0) }
        conflicts = []
        message = nil
    }

    // MARK: Accessible structure

    /// Handles a tap on the map; returns the camera the view should animate to, if any.
    public func handleTap(at point: Vec2, size: Vec2, now: Date = Date()) -> (toggle: ToggleResult?, camera: SeatMapCamera?) {
        let cam = geometry.clamp(camera, size: size)
        switch tapInterpreter.interpret(point: point, at: now, geometry: geometry, camera: cam, size: size) {
        case .toggle(let id): return (toggle(id, now: now), nil)
        case .zoomIn(let anchor): return (nil, geometry.zoom(cam, by: 2, anchor: anchor, size: size))
        case .focusArea(let anchor): return (nil, geometry.zoom(cam, by: 2.4, anchor: anchor, size: size))
        case .resetZoom: return (nil, geometry.fitCamera)
        case .none: return (nil, nil)
        }
    }

    public struct RowGroup: Sendable, Identifiable {
        public let id: String
        public let label: String
        public let section: String
        public let seats: [Seat]
    }

    /// Sections → rows → seats in explicit order, independent of visual geometry.
    public var accessibleRows: [RowGroup] {
        let sections = Dictionary(uniqueKeysWithValues: layout.sections.map { ($0.id, $0) })
        let byRow = Dictionary(grouping: layout.seats, by: \.rowId)
        return layout.rows
            .sorted { (sections[$0.sectionId]?.order ?? 0, $0.order) < (sections[$1.sectionId]?.order ?? 0, $1.order) }
            .map { RowGroup(id: $0.id, label: $0.label, section: sections[$0.sectionId]?.name ?? "", seats: (byRow[$0.id] ?? []).sorted { $0.order < $1.order }) }
    }
}
