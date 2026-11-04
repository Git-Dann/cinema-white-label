import Foundation

/// What a seat looks like right now: physical category + live state + selection.
/// Shared by the Canvas renderer, the legend and the accessible list so they
/// can never disagree.
public struct SeatPresentation: Sendable, Hashable {
    public enum State: String, Sendable, Hashable {
        case available, selected, heldByOthers, sold, blocked, conflict
    }
    public enum Category: String, Sendable, Hashable {
        case standard, premium, recliner, sofa, wheelchair, companion
    }

    public let state: State
    public let category: Category
    public let restricted: Bool
    public let easyAccess: Bool

    public var isSelectable: Bool { state == .available || state == .selected || state == .conflict }

    /// SF Symbol drawn on the seat so state is never conveyed by colour alone.
    public var symbolName: String? {
        switch state {
        case .selected: return "checkmark"
        case .sold, .heldByOthers: return "xmark"
        case .blocked: return "minus"
        case .conflict: return "exclamationmark"
        case .available:
            switch category {
            case .wheelchair: return "figure.roll"
            case .companion: return "person.2.fill"
            default: return restricted ? "eye.trianglebadge.exclamationmark" : nil
            }
        }
    }

    public init(seat: Seat, availability: SeatAvailability?, isSelected: Bool, isConflict: Bool) {
        category = Category(rawValue: seat.type.rawValue) ?? .standard
        restricted = seat.restrictedView != nil
        easyAccess = seat.accessibility.contains(.easyAccess)
        if isConflict { state = .conflict }
        else if isSelected { state = .selected }
        else {
            switch availability ?? .available {
            case .available: state = .available
            case .held: state = .heldByOthers
            case .sold: state = .sold
            case .blocked: state = .blocked
            }
        }
    }
}

public enum SeatAccessibility {
    /// e.g. "Row F, Seat 8, standard, available, £12.50."
    public static func label(seat: Seat, rowLabel: String, presentation: SeatPresentation, price: String?) -> String {
        var parts = ["Row \(rowLabel)", seat.type == .wheelchair ? "Wheelchair space \(seat.label.replacingOccurrences(of: "W", with: ""))" : "Seat \(seat.label)"]
        parts.append(categoryName(presentation.category))
        parts.append(stateName(presentation.state))
        if let price, presentation.isSelectable { parts.append(price) }
        if let r = seat.restrictedView { parts.append(r) }
        if presentation.easyAccess { parts.append("easy access") }
        return parts.joined(separator: ", ") + "."
    }

    public static func hint(presentation: SeatPresentation) -> String? {
        switch presentation.state {
        case .available: return "Double-tap to select."
        case .selected: return "Double-tap to remove from your selection."
        case .conflict: return "No longer available. Double-tap to remove it."
        default: return nil
        }
    }

    public static func categoryName(_ c: SeatPresentation.Category) -> String {
        switch c {
        case .standard: return "standard"
        case .premium: return "premium"
        case .recliner: return "recliner"
        case .sofa: return "sofa seat, sold in pairs"
        case .wheelchair: return "wheelchair space"
        case .companion: return "companion seat"
        }
    }

    public static func stateName(_ s: SeatPresentation.State) -> String {
        switch s {
        case .available: return "available"
        case .selected: return "selected"
        case .heldByOthers: return "being booked by someone else"
        case .sold: return "sold"
        case .blocked: return "unavailable"
        case .conflict: return "no longer available"
        }
    }
}
