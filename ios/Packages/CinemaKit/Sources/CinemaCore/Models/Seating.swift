import Foundation

/// Operator-configured seat category (mirrors `packages/contracts/src/seating.ts`).
/// Keyed by `Seat.priceCategory`; changes without an app update.
public struct SeatCategory: Codable, Sendable, Hashable, Identifiable {
    public enum Shape: String, Codable, Sendable {
        case seat, recliner, pod, bed, sofa, space
        public init(from decoder: any Decoder) throws {
            self = Shape(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .seat
        }
    }
    public struct Appearance: Codable, Sendable, Hashable { public var fill: String; public var accent: String }
    public struct Colours: Codable, Sendable, Hashable { public var light: Appearance; public var dark: Appearance }

    /// SF Symbols the app will render; anything else from the server is ignored.
    public static let allowedIcons: Set<String> = ["star.fill", "crown.fill", "sparkles", "bed.double.fill", "sofa.fill", "chair.lounge.fill", "figure.roll", "person.2.fill", "ear", "leaf.fill"]

    public var id: String
    public var label: String
    public var description: String?
    public var shape: Shape
    public var icon: String?
    public var colours: Colours?
    public var sortOrder: Int

    public init(id: String, label: String, description: String? = nil, shape: Shape, icon: String? = nil, colours: Colours? = nil, sortOrder: Int = 0) {
        self.id = id; self.label = label; self.description = description; self.shape = shape; self.icon = icon; self.colours = colours; self.sortOrder = sortOrder
    }

    public var safeIcon: String? { icon.flatMap { Self.allowedIcons.contains($0) ? $0 : nil } }

    /// Fallback when a screening arrives without category metadata.
    public static func fallback(for priceCategory: String, kind: Seat.Kind) -> SeatCategory {
        let shape: Shape = switch kind {
        case .recliner: .recliner
        case .sofa: .sofa
        case .luxePod: .pod
        case .vipBed: .bed
        case .wheelchair: .space
        default: .seat
        }
        return SeatCategory(id: priceCategory, label: priceCategory.replacingOccurrences(of: "-", with: " ").capitalized, shape: shape)
    }
}

/// Operator seat rules evaluated on device for instant feedback and again on the server.
public struct SeatRules: Codable, Sendable, Hashable {
    public enum OrphanPolicy: String, Codable, Sendable { case allow, warn, block }
    public enum CompanionPolicy: String, Codable, Sendable { case none, warn, requireWheelchair }
    public var maxTickets: Int
    public var orphanSeatPolicy: OrphanPolicy
    public var companionPolicy: CompanionPolicy

    public init(maxTickets: Int = 10, orphanSeatPolicy: OrphanPolicy = .warn, companionPolicy: CompanionPolicy = .warn) {
        self.maxTickets = maxTickets; self.orphanSeatPolicy = orphanSeatPolicy; self.companionPolicy = companionPolicy
    }
}

public struct VenueFeatures: Codable, Sendable, Hashable {
    public var concessions: Bool
    public var seatDelivery: Bool
    public init(concessions: Bool = true, seatDelivery: Bool = false) { self.concessions = concessions; self.seatDelivery = seatDelivery }
}

public struct Typography: Codable, Sendable, Hashable {
    public enum Design: String, Codable, Sendable { case `default`, serif, rounded }
    public enum Weight: String, Codable, Sendable { case semibold, bold, heavy }
    public var design: Design
    public var headingWeight: Weight
    public static let standard = Typography(design: .default, headingWeight: .bold)
}
