import Foundation
import Observation

/// Loads, validates and caches the tenant configuration.
///
/// Order of trust: last known-good cache → bundled fallback → remote update.
/// A remote config is only adopted if it decodes, has a supported schema
/// version, is for this tenant, and passes contrast validation. Otherwise the
/// app keeps what it has and records a `theme_load_failed` event.
@MainActor
@Observable
public final class TenantConfigStore {
    public enum Source: String, Sendable { case bundled, cached, remote }

    public private(set) var config: TenantConfig
    public private(set) var source: Source
    public private(set) var lastRejection: String?
    /// Theme the customer chose in Settings, if the tenant offers it.
    public var preferredThemeID: ThemeID? {
        didSet { defaults.set(preferredThemeID?.rawValue, forKey: "preferredTheme.\(config.tenant.slug)") }
    }

    private let cacheURL: URL
    private let defaults: UserDefaults
    private var etag: String?

    public init(bundled: TenantConfig, cacheDirectory: URL, defaults: UserDefaults = .standard) {
        self.cacheURL = cacheDirectory.appendingPathComponent("tenant-config-\(bundled.tenant.slug).json")
        self.defaults = defaults
        if let data = try? Data(contentsOf: cacheURL),
           let cached = try? APIClient.decoder.decode(CachedConfig.self, from: data),
           Self.rejectionReason(cached.config, expectedTenant: bundled.tenant.slug) == nil,
           cached.config.version >= bundled.version {
            self.config = cached.config
            self.etag = cached.etag
            self.source = .cached
        } else {
            self.config = bundled
            self.source = .bundled
        }
        self.preferredThemeID = defaults.string(forKey: "preferredTheme.\(bundled.tenant.slug)").flatMap(ThemeID.init(rawValue:))
    }

    /// Returns nil if the config is acceptable, otherwise a reason.
    public nonisolated static func rejectionReason(_ c: TenantConfig, expectedTenant: String) -> String? {
        if c.schemaVersion != TenantConfig.supportedSchemaVersion { return "Unsupported schema version \(c.schemaVersion)" }
        if c.tenant.slug != expectedTenant { return "Configuration is for a different operator" }
        for theme in c.allThemes {
            let issues = ContrastValidator.validate(theme)
            if let first = issues.first { return "\(theme.name) failed contrast validation: \(first)" }
        }
        return nil
    }

    /// Fetches and adopts a newer configuration if valid. Safe to call often (ETag).
    @discardableResult
    public func refresh(using service: any CinemaService) async -> Bool {
        do {
            let (fresh, newEtag) = try await service.fetchConfig(etag: etag)
            guard let fresh else { return false } // 304 Not Modified
            if let reason = Self.rejectionReason(fresh, expectedTenant: config.tenant.slug) {
                lastRejection = reason
                return false
            }
            guard fresh.version >= config.version || source == .bundled else { return false }
            config = fresh
            etag = newEtag
            source = .remote
            lastRejection = nil
            persist()
            return true
        } catch {
            return false
        }
    }

    /// Adopts a configuration directly (used by tests and previews).
    public func adopt(_ c: TenantConfig) -> Bool {
        guard Self.rejectionReason(c, expectedTenant: config.tenant.slug) == nil else { return false }
        config = c
        source = .remote
        persist()
        return true
    }

    /// The theme to render: Increase Contrast prefers High Contrast when offered.
    public func activeTheme(increasedContrast: Bool) -> ResolvedTheme {
        let all = config.allThemes
        if increasedContrast, let hc = all.first(where: { $0.themeId == .highContrast }) { return hc }
        if let id = preferredThemeID, let chosen = all.first(where: { $0.themeId == id }) { return chosen }
        return config.theme
    }

    private struct CachedConfig: Codable { var config: TenantConfig; var etag: String? }

    private func persist() {
        do {
            try FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            let enc = JSONEncoder()
            enc.dateEncodingStrategy = .iso8601
            try enc.encode(CachedConfig(config: config, etag: etag)).write(to: cacheURL, options: .atomic)
        } catch {
            // Cache is an optimisation; the bundled config remains as fallback.
        }
    }
}
