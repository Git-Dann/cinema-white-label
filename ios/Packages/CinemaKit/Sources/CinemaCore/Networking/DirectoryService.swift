import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Finds operators for the shared Seatfold app, and fetches one operator's configuration
/// before the app switches to them.
public protocol DirectoryService: Sendable {
    func operators(query: String?, latitude: Double?, longitude: Double?) async throws -> [DirectoryEntry]
    func config(slug: String) async throws -> TenantConfig
}

public struct LiveDirectoryService: DirectoryService {
    public let baseURL: URL
    public let session: URLSession
    public init(baseURL: URL, session: URLSession = .shared) { self.baseURL = baseURL; self.session = session }

    public func operators(query: String?, latitude: Double?, longitude: Double?) async throws -> [DirectoryEntry] {
        var c = URLComponents(url: URL(string: "v1/directory", relativeTo: baseURL)!.absoluteURL, resolvingAgainstBaseURL: false)!
        var items: [URLQueryItem] = []
        if let query, !query.trimmingCharacters(in: .whitespaces).isEmpty { items.append(URLQueryItem(name: "q", value: query)) }
        if let latitude, let longitude {
            items.append(URLQueryItem(name: "lat", value: String(latitude)))
            items.append(URLQueryItem(name: "lng", value: String(longitude)))
        }
        c.queryItems = items.isEmpty ? nil : items
        return try await get(c.url!, as: [DirectoryEntry].self)
    }

    public func config(slug: String) async throws -> TenantConfig {
        try await get(URL(string: "v1/t/\(slug)/config", relativeTo: baseURL)!.absoluteURL, as: TenantConfig.self)
    }

    private func get<T: Decodable>(_ url: URL, as: T.Type) async throws -> T {
        var req = URLRequest(url: url)
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        let (data, response) = try await session.data(for: req)
        guard let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else { throw URLError(.badServerResponse) }
        return try APIClient.decoder.decode(T.self, from: data)
    }
}

/// Offline demo: the operators whose configuration ships in the app (the fictional Northlight and
/// Kestrel), with the demo cinemas. Lets the shared app be shown without a backend.
public struct DemoDirectoryService: DirectoryService {
    public static let slugs = ["northlight", "kestrel"]
    public init() {}

    public func operators(query: String?, latitude: Double?, longitude: Double?) async throws -> [DirectoryEntry] {
        Self.slugs.compactMap(BundledConfig.load(tenantSlug:)).map { c in
            DirectoryEntry(
                slug: c.tenant.slug,
                name: c.tenant.name,
                wordmark: c.branding.wordmark,
                logoLightUrl: c.branding.logoLightUrl,
                logoDarkUrl: c.branding.logoDarkUrl,
                accent: .init(light: c.branding.palette.accent.light, dark: c.branding.palette.accent.dark),
                venues: PreviewFixtures.venues.map { .init(name: $0.name, city: $0.address.city) }
            )
        }
        .filter { $0.matches(query ?? "") }
    }

    public func config(slug: String) async throws -> TenantConfig {
        guard let c = BundledConfig.load(tenantSlug: slug) else { throw URLError(.fileDoesNotExist) }
        return c
    }
}
