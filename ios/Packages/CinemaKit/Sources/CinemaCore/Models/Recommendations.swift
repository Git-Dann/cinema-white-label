import Foundation

/// Films the server suggests for this customer (Pulse recommendations). Order and reasons come from the server.
public struct RecommendationList: Codable, Sendable, Hashable {
    public struct Basis: Codable, Sendable, Hashable {
        /// True when the list is built from this customer's own bookings; false means popular picks.
        public var personal: Bool
        public init(personal: Bool) { self.personal = personal }
    }

    public struct Item: Codable, Sendable, Hashable {
        public struct FilmRef: Codable, Sendable, Hashable {
            public var id: String
            public var title: String
            public init(id: String, title: String) { self.id = id; self.title = title }
        }
        public var film: FilmRef
        public var reason: String
        public init(film: FilmRef, reason: String) { self.film = film; self.reason = reason }
    }

    public var basis: Basis
    public var recommendations: [Item]

    public init(basis: Basis, recommendations: [Item]) {
        self.basis = basis
        self.recommendations = recommendations
    }

    public static let empty = RecommendationList(basis: .init(personal: false), recommendations: [])

    /// A recommendation matched to a film the app already has, so it can show the full poster card.
    public struct Resolved: Sendable, Hashable, Identifiable {
        public var film: Film
        public var reason: String
        public var id: String { film.id }

        /// Short form of the server's reason for a two-line poster caption.
        public var caption: String {
            if let x = Self.between(reason, "People who booked ", " also booked this") { return "Booked by fans of \(x)" }
            if reason.hasPrefix("Like "), let colon = reason.firstIndex(of: ":") { return String(reason[..<colon]) }
            if reason.hasPrefix("Popular") { return "Popular right now" }
            return reason
        }

        private static func between(_ s: String, _ head: String, _ tail: String) -> String? {
            guard s.hasPrefix(head), s.hasSuffix(tail), s.count > head.count + tail.count else { return nil }
            return String(s.dropFirst(head.count).dropLast(tail.count))
        }
    }

    /// Keeps server order, drops films the app can't show (not loaded or already booked), and caps the row.
    public func resolved(against films: [Film], excluding bookedFilmIDs: Set<String> = [], limit: Int = 10) -> [Resolved] {
        let byID = Dictionary(films.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var seen = Set<String>()
        var out: [Resolved] = []
        for item in recommendations where out.count < limit {
            guard let film = byID[item.film.id], !bookedFilmIDs.contains(film.id), seen.insert(film.id).inserted else { continue }
            out.append(Resolved(film: film, reason: item.reason))
        }
        return out
    }

    /// Header subtitle: honest about whether the picks are personal.
    public var subtitle: String { basis.personal ? "Picked from what you've booked" : "Popular at your cinema" }
}
