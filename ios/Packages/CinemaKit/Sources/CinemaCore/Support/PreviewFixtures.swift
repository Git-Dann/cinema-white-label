import Foundation

/// Representative fictional data for SwiftUI previews, tests and offline demos.
/// Layouts and tenant configs are the same JSON the backend seeds from.
public enum PreviewFixtures {
    public enum LayoutName: String, CaseIterable, Sendable { case standard, curved, luxe, premiere }

    public static func layout(_ name: LayoutName) -> AuditoriumLayout {
        decode(AuditoriumLayout.self, name.rawValue)
    }

    public static func config(_ slug: String = "northlight") -> TenantConfig {
        decode(TenantConfig.self, "tenant-config-\(slug)", decoder: APIClient.decoder)
    }

    private static func decode<T: Decodable>(_ type: T.Type, _ name: String, decoder: JSONDecoder = JSONDecoder()) -> T {
        guard let url = Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "PreviewData"),
              let data = try? Data(contentsOf: url) else { fatalError("Missing preview fixture \(name)") }
        do { return try decoder.decode(T.self, from: data) } catch { fatalError("Invalid preview fixture \(name): \(error)") }
    }

    /// Offline catalogue (original fictional films) with bundled artwork.
    public static let films: [Film] = {
        guard let url = Bundle.module.url(forResource: "mock-films", withExtension: "json", subdirectory: "PreviewData"),
              let data = try? Data(contentsOf: url),
              var films = try? JSONDecoder().decode([Film].self, from: data) else { return [] }
        func localise(_ ref: ImageRef?) -> ImageRef? {
            guard var r = ref else { return nil }
            let name = (r.url as NSString).lastPathComponent
            let file = Bundle.module.url(forResource: (name as NSString).deletingPathExtension, withExtension: "jpg", subdirectory: "PreviewData/artwork")
            r.url = file?.absoluteString ?? r.url
            return r
        }
        for i in films.indices {
            films[i].poster = localise(films[i].poster)
            films[i].backdrop = localise(films[i].backdrop)
        }
        return films
    }()

    public static let venues: [Venue] = [
        Venue(id: "leeds-riverside", slug: "leeds-riverside", name: "Northlight Leeds Riverside", address: .init(line1: "12 Wharf Approach", city: "Leeds", postcode: "LS1 4AB"),
              coordinate: .init(latitude: 53.7942, longitude: -1.5418), timeZone: "Europe/London", phone: nil,
              facilities: ["Wheelchair access", "Hearing loop", "Bar", "Seat delivery"], screenCount: 4, isFavourite: true, distanceKm: 0.8,
              features: VenueFeatures(concessions: true, seatDelivery: true)),
        Venue(id: "manchester-ancoats", slug: "manchester-ancoats", name: "Northlight Manchester Ancoats", address: .init(line1: "3 Mill Yard", city: "Manchester", postcode: "M4 6DE"),
              coordinate: .init(latitude: 53.4851, longitude: -2.2276), timeZone: "Europe/London", phone: nil,
              facilities: ["Wheelchair access", "IMAX", "Bar"], screenCount: 3, isFavourite: false, distanceKm: 58.4,
              features: VenueFeatures(concessions: true, seatDelivery: false)),
    ]

    public static let seatCategories: [SeatCategory] = [
        .init(id: "standard", label: "Standard", shape: .seat, sortOrder: 0),
        .init(id: "premium", label: "Premium", description: "Extra legroom, best view", shape: .seat, icon: "star.fill", sortOrder: 1),
        .init(id: "recliner", label: "Recliner", description: "Fully reclining leather seat", shape: .recliner, icon: "chair.lounge.fill", sortOrder: 2),
        .init(id: "sofa", label: "Sofa", description: "Two-seat sofa, sold as a pair", shape: .sofa, icon: "sofa.fill", sortOrder: 3),
        .init(id: "luxe-pod", label: "Luxe Pod", description: "Private reclining pod with table service", shape: .pod, icon: "sparkles", sortOrder: 4),
        .init(id: "vip-bed", label: "VIP Bed", description: "Double bed for two, sold as a pair", shape: .bed, icon: "bed.double.fill", sortOrder: 5),
    ]

    public static let pricing = Pricing(
        currency: "GBP", bookingFeePerTicketMinor: 95, supplements: [],
        ticketTypes: [
            .init(id: "adult", code: "ADULT", name: "Adult", description: "Ages 15 and over", requiresProof: false,
                  prices: ["standard": 1250, "premium": 1550, "recliner": 1895, "sofa": 1795, "luxe-pod": 2495, "vip-bed": 3495]),
            .init(id: "child", code: "CHILD", name: "Child", description: "Ages 3 to 14", requiresProof: false,
                  prices: ["standard": 899, "premium": 1199, "recliner": 1495, "sofa": 1495, "luxe-pod": 1995, "vip-bed": 2995]),
            .init(id: "concession", code: "CONCESSION", name: "Student / Senior", description: "Valid ID may be requested", requiresProof: true,
                  prices: ["standard": 1050, "premium": 1350, "recliner": 1695, "sofa": 1595, "luxe-pod": 2295, "vip-bed": 3195]),
        ]
    )

    public static func screening(_ name: LayoutName = .standard, id: String? = nil, rules: SeatRules = SeatRules(), start: Date = Date().addingTimeInterval(86400)) -> ScreeningDetail {
        let layout = layout(name)
        return ScreeningDetail(
            id: id ?? "preview-\(name.rawValue)", startsAt: start, endsAt: start.addingTimeInterval(8400), localDate: "2026-11-06",
            formats: name == .curved ? ["IMAX"] : ["2D"], attributes: [], onSale: true,
            availability: .init(available: layout.seats.count, total: layout.seats.count, level: .good),
            film: .init(id: "the-lantern-keeper", title: "The Lantern Keeper", certificate: "12A", runtimeMinutes: 128, poster: nil),
            venue: .init(id: "leeds-riverside", name: "Northlight Leeds Riverside", timeZone: "Europe/London"),
            auditorium: .init(id: "aud-\(name.rawValue)", name: layout.name, screenNumber: 1),
            layoutVersion: .init(id: "lv-\(name.rawValue)", version: 1),
            layout: layout, pricing: pricing, seatCategories: seatCategories, seatRules: rules
        )
    }

    /// Deterministic, realistic availability: back-middle sells first, a few blocked seats.
    public static func availability(for screening: ScreeningDetail, occupancy: Double = 0.35, seed: UInt64 = 7) -> AvailabilitySnapshot {
        var rng = SeededGenerator(seed: seed)
        let layout = screening.layout
        let maxY = layout.seats.map(\.y).max() ?? 1
        var seats: [String: SeatAvailability] = [:]
        for s in layout.seats {
            let centrality = 1 - min(1, abs(s.x - 0.5) * 2)
            let depth = s.y / maxY
            let demand = occupancy * (0.4 + 0.8 * centrality * depth)
            let r = Double.random(in: 0..<1, using: &rng)
            seats[s.id] = r < 0.012 ? .blocked : r < demand ? .sold : r < demand + 0.03 ? .held : .available
        }
        return AvailabilitySnapshot(screeningId: screening.id, serverTime: Date(), version: 1, seats: seats, yourHold: nil)
    }

    public static let menu = ConcessionMenu(
        features: VenueFeatures(concessions: true, seatDelivery: true),
        categories: [
            .init(name: "Popcorn", items: [
                product("pop-sweet", "Sweet popcorn", 650, dietary: ["Vegan", "Gluten free"], groups: [sizeGroup(195)]),
                product("pop-salt", "Salted popcorn", 650, dietary: ["Vegan", "Gluten free"], groups: [sizeGroup(195)]),
            ]),
            .init(name: "Drinks", items: [
                product("drink", "Fountain drink", 450, dietary: ["Vegan"], groups: [sizeGroup(135), .init(id: "drink", name: "Drink", min: 1, max: 1, options: [.init(id: "cola", name: "Cola", priceMinor: 0), .init(id: "lemonade", name: "Sparkling lemonade", priceMinor: 0)])]),
            ]),
            .init(name: "Combos", items: [
                product("combo", "Date night combo", 1595, bundle: ["Large popcorn", "2 × regular drinks"], groups: [
                    .init(id: "popcorn", name: "Popcorn", min: 1, max: 1, options: [.init(id: "sweet", name: "Sweet", priceMinor: 0), .init(id: "salted", name: "Salted", priceMinor: 0)]),
                    .init(id: "drinks", name: "Drinks", min: 2, max: 2, options: [.init(id: "cola", name: "Cola", priceMinor: 0), .init(id: "lemonade", name: "Sparkling lemonade", priceMinor: 0), .init(id: "water", name: "Still water", priceMinor: 0)]),
                ]),
            ]),
            .init(name: "Sweets", items: [
                product("icecream", "Vanilla ice cream tub", 425, allergens: ["Milk"], stock: .out),
            ]),
        ]
    )

    static func sizeGroup(_ largeExtra: Int) -> ConcessionProduct.ModifierGroup {
        .init(id: "size", name: "Size", min: 1, max: 1, options: [.init(id: "regular", name: "Regular", priceMinor: 0), .init(id: "large", name: "Large", priceMinor: largeExtra)])
    }

    static func product(_ id: String, _ name: String, _ price: Int, allergens: [String] = [], dietary: [String] = [], bundle: [String] = [], groups: [ConcessionProduct.ModifierGroup] = [], stock: ConcessionProduct.Stock = .inStock) -> ConcessionProduct {
        ConcessionProduct(id: id, sku: id.uppercased(), name: name, description: nil, priceMinor: price, allergens: allergens, dietary: dietary, calories: nil, stockStatus: stock, modifierGroups: groups, bundleItems: bundle, image: nil)
    }
}

/// Small deterministic PRNG so previews and tests are stable.
public struct SeededGenerator: RandomNumberGenerator, Sendable {
    private var state: UInt64
    public init(seed: UInt64) { state = seed &+ 0x9E3779B97F4A7C15 }
    public mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}
