import Foundation

public struct ImageRef: Codable, Sendable, Hashable {
    public var id: String
    /// Relative URL (e.g. /v1/media/abc?v=1). Resolve against the API base URL.
    public var url: String
    public var width: Int
    public var height: Int
    public var aspectRatio: Double
    public var focalPoint: FocalPoint
    public var dominantColor: String?
    public var attribution: String?
    public var renditions: [Int]

    public struct FocalPoint: Codable, Sendable, Hashable { public var x: Double; public var y: Double }

    /// Picks the smallest rendition at least `pixelWidth` wide (never upscaled server-side).
    public func url(forPixelWidth pixelWidth: Double, base: URL) -> URL? {
        // Bundled offline artwork (mock/preview mode) is a single local file.
        if url.hasPrefix("file:") { return URL(string: url) }
        let w = renditions.first { Double($0) >= pixelWidth } ?? renditions.last ?? width
        let separator = url.contains("?") ? "&" : "?"
        return URL(string: "\(url)\(separator)w=\(w)", relativeTo: base)?.absoluteURL
    }
}

public struct Film: Codable, Sendable, Hashable, Identifiable {
    public enum Status: String, Codable, Sendable { case nowShowing, comingSoon }
    public struct Trailer: Codable, Sendable, Hashable, Identifiable {
        public var id: String
        public var title: String
        public var kind: String
        /// Null when no licensed trailer source is configured.
        public var url: String?
        public var durationSeconds: Int?
    }

    public var id: String
    public var slug: String
    public var title: String
    public var tagline: String?
    public var synopsis: String
    public var releaseDate: String
    public var runtimeMinutes: Int
    public var certificate: String
    public var genres: [String]
    public var director: String?
    public var cast: [String]
    public var status: Status
    public var formats: [String]
    public var poster: ImageRef?
    public var backdrop: ImageRef?
    public var trailers: [Trailer]
    public var attributions: [String]
    /// Title artwork (transparent PNG). Optional: older servers and cached payloads have none.
    public var logo: ImageRef?
    /// Cast in billing order, with photo and short biography where known.
    public var people: [Person]?
    public var crew: [CrewMember]?
    public var about: About?
    public var contentAdvice: ContentAdvice?

    public struct Person: Codable, Sendable, Hashable, Identifiable {
        public var id: String
        public var name: String
        public var character: String?
        public var biography: String?
        public var photo: ImageRef?
    }

    public struct CrewMember: Codable, Sendable, Hashable {
        public var name: String
        public var job: String
        public init(name: String, job: String) { self.name = name; self.job = job }
    }

    public struct About: Codable, Sendable, Hashable {
        public var originalTitle: String?
        public var spokenLanguages: [String]
        public var originCountries: [String]
        public var productionCompanies: [String]
        public var status: String?
        public var budget: Int?
        public var keywords: [String]
    }

    /// Parents Guide: the certificate and what it means, then BBFC advice by category.
    public struct ContentAdvice: Codable, Sendable, Hashable {
        public var certificate: String
        public var meaning: String?
        public var items: [Item]

        public struct Item: Codable, Sendable, Hashable, Identifiable {
            public enum Level: String, Codable, Sendable { case strong = "Strong", moderate = "Moderate", mild = "Mild", contains = "Contains" }
            public var category: String
            public var level: Level
            public var text: String
            public var id: String { category }
        }
    }

    /// Crew grouped by job in display order, e.g. ("Director", ["Name"]), ("Screenplay", ["A", "B"]).
    public var crewByJob: [(job: String, names: [String])] {
        var out: [(job: String, names: [String])] = []
        for c in crew ?? [] {
            if let i = out.firstIndex(where: { $0.job == c.job }) { out[i].names.append(c.name) } else { out.append((c.job, [c.name])) }
        }
        return out
    }
}

public struct Venue: Codable, Sendable, Hashable, Identifiable {
    public struct Address: Codable, Sendable, Hashable { public var line1: String; public var city: String; public var postcode: String }
    public struct Coordinate: Codable, Sendable, Hashable { public var latitude: Double; public var longitude: Double }
    public var id: String
    public var slug: String
    public var name: String
    public var address: Address
    public var coordinate: Coordinate
    public var timeZone: String
    public var phone: String?
    public var facilities: [String]
    public var screenCount: Int?
    public var isFavourite: Bool
    public var distanceKm: Double?
    /// Location-level feature flags (food and drink, seat delivery).
    public var features: VenueFeatures?

    /// Name without the operator prefix, e.g. "Leeds Riverside".
    public func shortName(operatorWordmark: String) -> String {
        name.hasPrefix(operatorWordmark + " ") ? String(name.dropFirst(operatorWordmark.count + 1)) : name
    }
}

public struct ScreeningSummary: Codable, Sendable, Hashable, Identifiable {
    public struct Availability: Codable, Sendable, Hashable {
        public enum Level: String, Codable, Sendable { case good, limited, soldOut }
        public var available: Int
        public var total: Int
        public var level: Level
    }
    public struct FilmRef: Codable, Sendable, Hashable { public var id: String; public var title: String; public var certificate: String; public var runtimeMinutes: Int; public var poster: ImageRef? }
    public struct VenueRef: Codable, Sendable, Hashable { public var id: String; public var name: String; public var timeZone: String }
    public struct AuditoriumRef: Codable, Sendable, Hashable { public var id: String; public var name: String; public var screenNumber: Int }

    public var id: String
    public var startsAt: Date
    public var endsAt: Date
    public var localDate: String
    public var formats: [String]
    public var attributes: [String]
    public var onSale: Bool
    public var availability: Availability
    public var film: FilmRef
    public var venue: VenueRef
    public var auditorium: AuditoriumRef
}

public struct ScreeningDetail: Codable, Sendable, Hashable, Identifiable {
    public var id: String
    public var startsAt: Date
    public var endsAt: Date
    public var localDate: String
    public var formats: [String]
    public var attributes: [String]
    public var onSale: Bool
    public var availability: ScreeningSummary.Availability
    public var film: ScreeningSummary.FilmRef
    public var venue: ScreeningSummary.VenueRef
    public var auditorium: ScreeningSummary.AuditoriumRef
    public var layoutVersion: LayoutVersionRef
    public var layout: AuditoriumLayout
    public var pricing: Pricing
    /// Operator seat categories used by this layout (labels, icons, shapes, colours).
    public var seatCategories: [SeatCategory]? = nil
    public var seatRules: SeatRules? = nil

    public struct LayoutVersionRef: Codable, Sendable, Hashable { public var id: String; public var version: Int }
}

public struct Pricing: Codable, Sendable, Hashable {
    public struct TicketType: Codable, Sendable, Hashable, Identifiable {
        public var id: String
        public var code: String
        public var name: String
        public var description: String?
        public var requiresProof: Bool
        /// Price in minor units per seat price category, including format supplements. Null = not sold.
        public var prices: [String: Int?]
    }
    public struct Supplement: Codable, Sendable, Hashable { public var format: String; public var amountMinor: Int }
    public var currency: String
    public var bookingFeePerTicketMinor: Int
    public var supplements: [Supplement]
    public var ticketTypes: [TicketType]

    /// The default ticket type used for the estimate shown while choosing seats.
    public var defaultTicketType: TicketType? { ticketTypes.first { $0.code == "ADULT" } ?? ticketTypes.first }

    public func price(for type: TicketType, category: String) -> Int? { type.prices[category] ?? nil }
}

public struct AvailabilitySnapshot: Codable, Sendable, Hashable {
    public struct HoldRef: Codable, Sendable, Hashable { public var id: String; public var seatIds: [String]; public var expiresAt: Date }
    public var screeningId: String
    public var serverTime: Date
    public var version: Int
    public var seats: [String: SeatAvailability]
    public var yourHold: HoldRef?
}

public struct AvailabilityChange: Codable, Sendable, Hashable {
    public struct Change: Codable, Sendable, Hashable { public var seatId: String; public var state: SeatAvailability }
    public var screeningId: String
    public var changes: [Change]
}
