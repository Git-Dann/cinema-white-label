import Foundation

/// Seat-selection rules, mirroring `backend/src/holds/seat-rules.ts` so the app
/// can explain problems instantly. The server re-evaluates on every hold; this
/// engine never grants anything the server would refuse.
///
/// Errors block continuing; warnings inform. Accessibility-related rules are
/// warnings unless the operator explicitly configures otherwise.
public struct SeatRulesEngine: Sendable {
    public struct Violation: Sendable, Hashable {
        public let code: String
        public let message: String
        public let seatIds: [String]
    }
    public struct Result: Sendable, Hashable {
        public var errors: [Violation] = []
        public var warnings: [Violation] = []
        public var isValid: Bool { errors.isEmpty }
    }

    public let layout: AuditoriumLayout
    public let rules: SeatRules
    private let seatsById: [String: Seat]
    private let neighbours: [String: (left: String?, right: String?)]
    private let groups: [String: [String]]
    private let rowLabels: [String: String]

    public init(layout: AuditoriumLayout, rules: SeatRules) {
        self.layout = layout
        self.rules = rules
        seatsById = Dictionary(uniqueKeysWithValues: layout.seats.map { ($0.id, $0) })
        rowLabels = Dictionary(uniqueKeysWithValues: layout.rows.map { ($0.id, $0.label) })
        var g: [String: [String]] = [:]
        for s in layout.seats { if let id = s.groupId { g[id, default: []].append(s.id) } }
        groups = g
        neighbours = Self.rowNeighbours(layout)
    }

    /// Seats adjacent within the same row and block; an aisle breaks adjacency.
    public static func rowNeighbours(_ layout: AuditoriumLayout) -> [String: (left: String?, right: String?)] {
        var out: [String: (left: String?, right: String?)] = [:]
        for (_, seats) in Dictionary(grouping: layout.seats, by: \.rowId) {
            let sorted = seats.sorted { $0.order < $1.order }
            func touching(_ a: Seat, _ b: Seat) -> Bool {
                ((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y)).squareRoot() <= (a.width + b.width) / 2 * 1.35
            }
            for (i, s) in sorted.enumerated() {
                let l = i > 0 && touching(sorted[i - 1], s) ? sorted[i - 1].id : nil
                let r = i + 1 < sorted.count && touching(s, sorted[i + 1]) ? sorted[i + 1].id : nil
                out[s.id] = (l, r)
            }
        }
        return out
    }

    public func neighbours(of seatId: String) -> (left: String?, right: String?) { neighbours[seatId] ?? (nil, nil) }

    private func name(_ id: String) -> String {
        guard let s = seatsById[id] else { return id }
        return "\(rowLabels[s.rowId] ?? s.rowId)\(s.label)"
    }

    /// - Parameter unavailable: seats this customer cannot take (sold, blocked, held by others).
    public func evaluate(selected: [String], unavailable: Set<String>) -> Result {
        var r = Result()
        let sel = Set(selected)
        if selected.isEmpty { return r }
        if selected.count > rules.maxTickets {
            r.errors.append(.init(code: "max_tickets", message: "You can book up to \(rules.maxTickets) seats at once.", seatIds: selected))
        }

        for (_, members) in groups {
            let chosen = members.filter(sel.contains)
            if !chosen.isEmpty && chosen.count < members.count {
                let kind = seatsById[members[0]]?.type == .vipBed ? "VIP beds" : "Sofa seats"
                r.errors.append(.init(code: "group_incomplete", message: "\(kind) are sold in pairs. Select both places.", seatIds: members))
            }
        }

        let companions = selected.filter { seatsById[$0]?.type == .companion }
        switch rules.companionPolicy {
        case .requireWheelchair:
            let orphaned = companions.filter { id in
                let partners = seatsById[id]?.companionFor ?? []
                return !partners.isEmpty && !partners.contains(where: sel.contains)
            }
            if !orphaned.isEmpty {
                r.errors.append(.init(code: "companion_requires_wheelchair", message: "Companion seats are booked together with the wheelchair space next to them.", seatIds: orphaned))
            }
        case .warn where !companions.isEmpty:
            r.warnings.append(.init(code: "companion_seat", message: "Companion seats are next to a wheelchair space and may be reassigned for access needs.", seatIds: companions))
        default: break
        }

        let wheelchair = selected.filter { seatsById[$0]?.type == .wheelchair }
        if !wheelchair.isEmpty {
            r.warnings.append(.init(code: "wheelchair_space", message: "This is a wheelchair space with no fixed seat.", seatIds: wheelchair))
        }
        if let restricted = selected.first(where: { seatsById[$0]?.restrictedView != nil }), let text = seatsById[restricted]?.restrictedView {
            r.warnings.append(.init(code: "restricted_view", message: text, seatIds: selected.filter { seatsById[$0]?.restrictedView != nil }))
        }

        if rules.orphanSeatPolicy != .allow {
            func taken(_ id: String?) -> Bool { id == nil || unavailable.contains(id!) || sel.contains(id!) }
            let orphans = layout.seats.filter { s in
                guard !sel.contains(s.id), !unavailable.contains(s.id), s.type != .wheelchair else { return false }
                let n = neighbours(of: s.id)
                let touches = (n.left.map(sel.contains) ?? false) || (n.right.map(sel.contains) ?? false)
                return touches && taken(n.left) && taken(n.right)
            }.map(\.id)
            if !orphans.isEmpty {
                let list = orphans.map(name).joined(separator: ", ")
                let v = Violation(code: "orphan_seat", message: "Your selection leaves a single empty seat (\(list)). Try moving along one seat.", seatIds: orphans)
                if rules.orphanSeatPolicy == .block { r.errors.append(v) } else { r.warnings.append(v) }
            }
        }
        return r
    }
}

/// Interprets taps on the seat map. Single taps select instantly (no delay
/// waiting for a possible double tap). A double tap on empty space zooms in,
/// or back out to the whole auditorium when already fully zoomed.
public struct SeatTapInterpreter: Sendable {
    public enum Action: Equatable, Sendable {
        case toggle(String)
        case zoomIn(anchor: Vec2)
        case resetZoom
        case focusArea(anchor: Vec2)
        case none
    }

    public var doubleTapInterval: TimeInterval = 0.3
    public var doubleTapRadius: Double = 30
    /// Below this on-screen seat size, a tap zooms into the area first.
    public var minimumSelectableSeatSize: Double = 22
    private var lastEmptyTap: (point: Vec2, at: Date)?

    public init() {}

    public mutating func interpret(point: Vec2, at time: Date, geometry: SeatMapGeometry, camera: SeatMapCamera, size: Vec2) -> Action {
        if geometry.seatPointSize(camera: camera, size: size) < minimumSelectableSeatSize {
            lastEmptyTap = nil
            return .focusArea(anchor: point)
        }
        if let seat = geometry.hitTest(screenPoint: point, camera: camera, size: size) {
            lastEmptyTap = nil
            return .toggle(seat.id)
        }
        if let last = lastEmptyTap, time.timeIntervalSince(last.at) <= doubleTapInterval, (point - last.point).length <= doubleTapRadius {
            lastEmptyTap = nil
            return camera.zoom >= geometry.maxZoom(for: size) * 0.95 ? .resetZoom : .zoomIn(anchor: point)
        }
        lastEmptyTap = (point, time)
        return .none
    }
}
