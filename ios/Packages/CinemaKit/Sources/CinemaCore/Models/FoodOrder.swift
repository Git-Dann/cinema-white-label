import Foundation

/// The customer's food and drink order on the Food tab, before it is attached to
/// a booking. Holds choices only: every price shown at checkout comes from the
/// server quote; `estimatedSubtotal` is just the running figure on the basket bar.
public struct FoodBasket: Sendable, Hashable {
    public private(set) var items: [BasketItem] = []

    public init(items: [BasketItem] = []) { self.items = items }

    public var isEmpty: Bool { items.isEmpty }
    public var count: Int { items.reduce(0) { $0 + $1.quantity } }

    /// Adds an item, merging with an identical line (same product and options).
    public mutating func add(_ item: BasketItem) {
        guard item.quantity > 0 else { return }
        if let i = items.firstIndex(where: { $0.productId == item.productId && Self.same($0.modifiers, item.modifiers) }) {
            items[i].quantity = min(20, items[i].quantity + item.quantity)
        } else {
            items.append(item)
        }
    }

    public mutating func setQuantity(_ quantity: Int, for id: String) {
        guard let i = items.firstIndex(where: { $0.id == id }) else { return }
        if quantity <= 0 { items.remove(at: i) } else { items[i].quantity = min(20, quantity) }
    }

    public mutating func removeAll() { items.removeAll() }

    /// Drops lines whose product is no longer on the menu (e.g. after changing cinema or a sale ending).
    public mutating func keepOnly(in menu: ConcessionMenu) {
        items.removeAll { item in menu.product(id: item.productId).map { !$0.isAvailable } ?? true }
    }

    public func estimatedSubtotal(in menu: ConcessionMenu) -> Int {
        items.reduce(0) { sum, item in
            guard let p = menu.product(id: item.productId) else { return sum }
            return sum + ModifierValidation.unitPrice(product: p, modifiers: item.modifiers) * item.quantity
        }
    }

    private static func same(_ a: [String: [String]], _ b: [String: [String]]) -> Bool {
        let norm = { (m: [String: [String]]) in m.filter { !$0.value.isEmpty }.mapValues { Set($0) } }
        return norm(a) == norm(b)
    }
}

public enum FoodPreorder {
    /// Bookings food can be added to now, soonest first. When a cinema is given,
    /// bookings there come first, since the menu shown is that cinema's.
    public static func eligibleBookings(_ bookings: [Booking], venueId: String?, now: Date = Date()) -> [Booking] {
        bookings.filter { $0.canPreorder(now: now) }.sorted { a, b in
            let aHere = a.venue.id == venueId, bHere = b.venue.id == venueId
            if aHere != bHere { return aHere }
            return a.screening.startsAt < b.screening.startsAt
        }
    }
}
