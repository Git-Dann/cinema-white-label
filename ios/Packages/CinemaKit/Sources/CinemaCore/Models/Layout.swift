import Foundation

/// Auditorium geometry. Mirrors `packages/contracts/src/layout.ts`.
///
/// Coordinates are "layout units": the canvas is 1.0 wide and
/// `1 / aspectRatio` tall; x, y, width and height are all normalised to the
/// canvas width. Origin top-left, y down.
public struct AuditoriumLayout: Codable, Sendable, Hashable {
    public var id: String
    public var version: Int
    public var name: String
    public var aspectRatio: Double
    public var screen: Screen
    public var sections: [Section]
    public var rows: [Row]
    public var seats: [Seat]
    public var features: [Feature]

    public var height: Double { 1 / aspectRatio }

    public struct Point: Codable, Sendable, Hashable { public var x: Double; public var y: Double }

    public struct Screen: Codable, Sendable, Hashable {
        public enum Edge: String, Codable, Sendable { case top, bottom, left, right }
        public var center: Point
        public var width: Double
        public var curvature: Double
        public var edge: Edge
        public var label: String
    }

    public struct Section: Codable, Sendable, Hashable, Identifiable {
        public var id: String
        public var name: String
        public var order: Int
    }

    public struct Row: Codable, Sendable, Hashable, Identifiable {
        public var id: String
        public var sectionId: String
        public var label: String
        public var order: Int
    }

    public struct Feature: Codable, Sendable, Hashable, Identifiable {
        public enum Kind: String, Codable, Sendable { case aisle, walkway, entrance, exit, stairs, accessibleSpace, boundary, label, unknown
            public init(from decoder: any Decoder) throws { self = Kind(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown }
        }
        public var id: String
        public var kind: Kind
        public var label: String?
        public var x: Double
        public var y: Double
        public var width: Double
        public var height: Double
    }
}

public struct Seat: Codable, Sendable, Hashable, Identifiable {
    public enum Kind: String, Codable, Sendable, CaseIterable {
        case standard, premium, recliner, sofa, wheelchair, companion
    }
    public enum AccessFeature: String, Codable, Sendable { case wheelchair, easyAccess, transfer, hearingLoop, unknown
        public init(from decoder: any Decoder) throws { self = AccessFeature(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown }
    }

    public var id: String
    public var rowId: String
    public var sectionId: String
    public var label: String
    public var order: Int
    public var x: Double
    public var y: Double
    public var rotation: Double
    public var width: Double
    public var height: Double
    public var type: Kind
    public var priceCategory: String
    public var accessibility: [AccessFeature]
    public var companionFor: [String]
    public var groupId: String?
    public var restrictedView: String?

    /// True if the point (in layout units) lies inside the seat's rotated footprint.
    public func contains(_ p: AuditoriumLayout.Point) -> Bool {
        let dx = p.x - x, dy = p.y - y
        let a = -rotation * .pi / 180
        let lx = dx * cos(a) - dy * sin(a)
        let ly = dx * sin(a) + dy * cos(a)
        return abs(lx) <= width / 2 && abs(ly) <= height / 2
    }
}

/// Live state of a seat for one screening, from the availability endpoint.
public enum SeatAvailability: String, Codable, Sendable, Hashable {
    case available, held, sold, blocked
}
