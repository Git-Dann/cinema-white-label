import SwiftUI
import Security
import CinemaCore
import CinemaFeatures

/// App entry point. Everything operator-specific at build time comes from the
/// xcconfig for the selected scheme (bundle ID, icon, TENANT_SLUG, API_BASE_URL);
/// everything else is runtime tenant configuration from the backend.
@main
struct CinemaApp: App {
    @State private var app: AppModel

    init() {
        let info = Bundle.main.infoDictionary ?? [:]
        let slug = info["TenantSlug"] as? String ?? "northlight"
        let base = URL(string: info["APIBaseURL"] as? String ?? "http://localhost:3000/")!

        // Bundled known-good configuration so the app always has a valid theme offline.
        guard let url = Bundle.main.url(forResource: "tenant-config-\(slug)", withExtension: "json"),
              let data = try? Data(contentsOf: url),
              let bundled = try? APIClient.decoder.decode(TenantConfig.self, from: data) else {
            fatalError("Missing bundled tenant configuration for \(slug)")
        }

        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let tokens = GuestTokenProvider(baseURL: base, tenantSlug: slug, store: KeychainTokenStore(service: "\(Bundle.main.bundleIdentifier ?? "cinema").session"))
        let client = APIClient(baseURL: base, tenantSlug: slug, tokens: tokens)
        let service = LiveCinemaService(client: client)
        let model = AppModel(
            service: service,
            configStore: TenantConfigStore(bundled: bundled, cacheDirectory: support),
            tickets: TicketStore(cacheDirectory: support, tenantSlug: slug),
            mediaBaseURL: base
        )
        _app = State(initialValue: model)
    }

    var body: some Scene {
        WindowGroup {
            RootView(app: app)
        }
    }
}

/// Stores the session token in the Keychain (this device only, after first unlock).
struct KeychainTokenStore: GuestTokenProvider.Store {
    let service: String

    private var query: [String: Any] {
        [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: service, kSecAttrAccount as String: "guest"]
    }

    func load() -> String? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: CFTypeRef?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    func save(_ token: String?) {
        SecItemDelete(query as CFDictionary)
        guard let token else { return }
        var q = query
        q[kSecValueData as String] = Data(token.utf8)
        q[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(q as CFDictionary, nil)
    }
}
