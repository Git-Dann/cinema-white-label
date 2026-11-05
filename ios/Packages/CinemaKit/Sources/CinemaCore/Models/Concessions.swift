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

    public var isAvailable: Bool { stockStatus != .out }
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
