import Foundation

/// The known-good tenant configuration shipped inside the app, used until a
/// valid remote configuration has been fetched and cached. The JSON files are
/// written by the backend seed (backend/prisma/seed.ts) into CinemaCore's
/// resources, so the app target needs no separate copy.
public enum BundledConfig {
    public static func load(tenantSlug: String) -> TenantConfig? {
        guard let url = Bundle.module.url(forResource: "tenant-config-\(tenantSlug)", withExtension: "json", subdirectory: "PreviewData"),
              let data = try? Data(contentsOf: url) else { return nil }
        return try? APIClient.decoder.decode(TenantConfig.self, from: data)
    }
}
