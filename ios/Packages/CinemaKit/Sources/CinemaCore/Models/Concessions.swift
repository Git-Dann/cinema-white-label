import Foundation

/// Food and drink menu for a cinema (mirrors GET /venues/{id}/concessions).
public struct ConcessionMenu: Codable, Sendable, Hashable {
    public struct Category: Codable, Sendable, Hashable, Identifiable {
        public var name: String
        public var items: [ConcessionProduct]
        public var id: String { name }
    }
    public var features: VenueFeatures
    public var categories: [Category]
    public var isEmpty: Bool { categories.allSatisfy { $0.items.isEmpty } }
}

public struct ConcessionProduct: Codable, Sendable, Hashable, Identifiable {
    public enum Stock: String, Codable, Sendable {
        case inStock, low, out
        public init(from decoder: any Decoder) throws { self = Stock(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .inStock }
    }
    public struct ModifierGroup: Codable, Sendable, Hashable, Identifiable {
        public struct Option: Codable, Sendable, Hashable, Identifiable { public var id: String; public var name: String; public var priceMinor: Int }
        public var id: String
        public var name: String
        public var min: Int
        public var max: Int
        public var options: [Option]
        public var isSingleChoice: Bool { min == 1 && max == 1 }
    }
    public var id: String
    public var sku: String
    public var name: String
    public var description: String?
    public var priceMinor: Int
    public var allergens: [String]
    public var dietary: [String]
    public var calories: Int?
    public var stockStatus: Stock
    public var modifierGroups: [ModifierGroup]
    public var bundleItems: [String]
    public var image: ImageRef?
    /// Specials, deals and film tie-ins. Optional so older servers still decode.
    public var featured: Bool? = nil
    public var badge: String? = nil
    public var compareAtMinor: Int? = nil
    public var limitedEdition: Bool? = nil
    public var film: FilmLink? = nil
    public var availableUntil: Date? = nil

    public struct FilmLink: Codable, Sendable, Hashable { public var id: String; public var title: String
        public init(id: String, title: String) { self.id = id; self.title = title } }

    public var isAvailable: Bool { stockStatus != .out }
    public var isFeatured: Bool { featured == true }
    public var isLimitedEdition: Bool { limitedEdition == true }
    public var isBundle: Bool { !bundleItems.isEmpty }
    /// How much the deal saves against its "was" price, or nil when there is none.
    public var savingMinor: Int? {
        guard let was = compareAtMinor, was > priceMinor else { return nil }
        return was - priceMinor
    }
    /// The label to show on the card: the operator's own, else "Limited edition".
    public var displayBadge: String? { badge ?? (isLimitedEdition ? "Limited edition" : nil) }
}

public extension ConcessionMenu {
    /// Every product once, in menu order.
    var allItems: [ConcessionProduct] { categories.flatMap(\.items) }
    /// The Specials row: featured products that can be ordered first, sold-out ones last.
    var specials: [ConcessionProduct] { allItems.filter(\.isFeatured).sorted { $0.isAvailable && !$1.isAvailable } }
    /// Merchandise and food made for a film, grouped by film in menu order.
    var filmTieIns: [(film: ConcessionProduct.FilmLink, items: [ConcessionProduct])] {
        var order: [ConcessionProduct.FilmLink] = []
        var byFilm: [String: [ConcessionProduct]] = [:]
        for p in allItems { guard let f = p.film else { continue }; if byFilm[f.id] == nil { order.append(f) }; byFilm[f.id, default: []].append(p) }
        return order.map { ($0, byFilm[$0.id]!) }
    }
    /// Bundles and anything with a saving.
    var deals: [ConcessionProduct] { allItems.filter { $0.isBundle || $0.savingMinor != nil } }
    func product(id: String) -> ConcessionProduct? { allItems.first { $0.id == id } }
}

/// A customer's choice of one product with options.
public struct BasketItem: Codable, Sendable, Hashable, Identifiable {
    public var id: String = UUID().uuidString
    public var productId: String
    public var quantity: Int
    /// groupId → option ids
    public var modifiers: [String: [String]]

    public init(productId: String, quantity: Int = 1, modifiers: [String: [String]] = [:]) {
        self.productId = productId; self.quantity = quantity; self.modifiers = modifiers
    }

    enum CodingKeys: String, CodingKey { case productId, quantity, modifiers }
}

public enum ModifierValidation {
    /// Messages for unmet min/max constraints; empty when valid. Mirrors the server.
    public static func problems(product: ConcessionProduct, modifiers: [String: [String]]) -> [String] {
        product.modifierGroups.compactMap { g in
            let n = Set(modifiers[g.id] ?? []).count
            guard n < g.min || n > g.max else { return nil }
            return g.min == g.max ? "Choose \(g.min) \(g.name.lowercased())" : "Choose \(g.min) to \(g.max) \(g.name.lowercased())"
        }
    }

    /// Display estimate; the server quote is authoritative.
    public static func unitPrice(product: ConcessionProduct, modifiers: [String: [String]]) -> Int {
        product.priceMinor + product.modifierGroups.reduce(0) { sum, g in
            sum + g.options.filter { (modifiers[g.id] ?? []).contains($0.id) }.reduce(0) { $0 + $1.priceMinor }
        }
    }
}
