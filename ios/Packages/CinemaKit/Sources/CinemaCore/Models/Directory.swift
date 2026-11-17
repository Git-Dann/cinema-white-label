import Foundation

/// One operator in the shared Seatfold app's picker (`GET /v1/directory`).
/// Mirrors `DirectoryEntry` in packages/contracts/src/fleet.ts.
public struct DirectoryEntry: Codable, Sendable, Hashable, Identifiable {
    public struct Accent: Codable, Sendable, Hashable {
        public var light: String
        public var dark: String
        public init(light: String, dark: String) { self.light = light; self.dark = dark }
    }

    public struct VenueSummary: Codable, Sendable, Hashable {
        public var name: String
        public var city: String
        /// Set when the customer shared a location; the server sorts nearest first.
        public var distanceKm: Double?
        public init(name: String, city: String, distanceKm: Double? = nil) { self.name = name; self.city = city; self.distanceKm = distanceKm }
    }

    public var slug: String
    public var name: String
    public var wordmark: String
    public var logoLightUrl: String?
    public var logoDarkUrl: String?
    public var accent: Accent
    public var venues: [VenueSummary]
    public var id: String { slug }

    public init(slug: String, name: String, wordmark: String, logoLightUrl: String? = nil, logoDarkUrl: String? = nil, accent: Accent, venues: [VenueSummary]) {
        self.slug = slug; self.name = name; self.wordmark = wordmark; self.logoLightUrl = logoLightUrl; self.logoDarkUrl = logoDarkUrl; self.accent = accent; self.venues = venues
    }

    /// The line under the operator's name in the picker, e.g. "3 cinemas · nearest York, 2.4 mi".
    /// - Parameter distance: formats kilometres for the customer's locale (miles in the UK).
    public func summary(distance: (Double) -> String) -> String {
        guard let first = venues.first else { return "" }
        let away = first.distanceKm.map(distance)
        if venues.count == 1 {
            return [first.city, away].compactMap { $0 }.joined(separator: " · ")
        }
        if let away { return "\(venues.count) cinemas · nearest \(first.city), \(away)" }
        var towns: [String] = []
        for v in venues where !towns.contains(v.city) { towns.append(v.city) }
        let shown = towns.prefix(3).joined(separator: ", ")
        return "\(venues.count) cinemas · \(shown)\(towns.count > 3 ? " and more" : "")"
    }

    /// The same search the server runs: operator, cinema, town or postcode, ignoring case and spaces.
    public func matches(_ query: String) -> Bool {
        let q = Self.norm(query)
        guard !q.isEmpty else { return true }
        return Self.norm(name).contains(q) || venues.contains { Self.norm($0.name).contains(q) || Self.norm($0.city).contains(q) }
    }

    private static func norm(_ s: String) -> String { s.lowercased().filter { !$0.isWhitespace } }
}

/// How the app was built: one operator's own app, or the shared Seatfold app that lists many.
public enum AppMode: Equatable, Sendable {
    case branded(slug: String)
    case shared

    /// Reads `AppMode` and `TenantSlug` from Info.plist (set by the fleet xcconfig).
    public static func from(info: [String: Any]) -> AppMode {
        let slug = (info["TenantSlug"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        if (info["AppMode"] as? String) == "shared" || slug == nil { return .shared }
        return .branded(slug: slug!)
    }
}

/// Remembers which operator the customer chose in the shared app, and a copy of that operator's
/// configuration so the app opens in their theme offline next time.
public struct OperatorChoiceStore: @unchecked Sendable {
    public static let key = "seatfold.operator"
    private let defaults: UserDefaults
    private let directory: URL
    /// The App Group's defaults, so the widget knows which operator's tickets it shows.
    private let shared: UserDefaults?

    public init(defaults: UserDefaults = .standard, directory: URL, shared: UserDefaults? = nil) {
        self.defaults = defaults; self.directory = directory; self.shared = shared
    }

    public var slug: String? { defaults.string(forKey: Self.key) }

    /// Saves the choice and its configuration. Rejects a configuration the app couldn't show.
    public func choose(_ config: TenantConfig) throws {
        if let reason = TenantConfigStore.rejectionReason(config, expectedTenant: config.tenant.slug) {
            throw ChoiceError.unusableConfig(reason)
        }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(config).write(to: seedURL(config.tenant.slug), options: .atomic)
        defaults.set(config.tenant.slug, forKey: Self.key)
        shared?.set(config.tenant.slug, forKey: Self.key)
    }

    /// Back to the picker. Tickets and saved configs stay, so switching back is instant.
    public func clear() {
        defaults.removeObject(forKey: Self.key)
        shared?.removeObject(forKey: Self.key)
    }

    /// The configuration to start an operator's app with: the copy shipped in the app for the demo
    /// operators, otherwise the one saved when the customer chose them.
    public func seed(for slug: String) -> TenantConfig? {
        if let bundled = BundledConfig.load(tenantSlug: slug) { return bundled }
        guard let data = try? Data(contentsOf: seedURL(slug)),
              let config = try? APIClient.decoder.decode(TenantConfig.self, from: data),
              TenantConfigStore.rejectionReason(config, expectedTenant: slug) == nil else { return nil }
        return config
    }

    private func seedURL(_ slug: String) -> URL { directory.appendingPathComponent("operator-\(slug).json") }

    public enum ChoiceError: Error, Equatable { case unusableConfig(String) }
}
