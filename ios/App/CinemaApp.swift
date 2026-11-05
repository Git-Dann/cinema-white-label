import SwiftUI
import UIKit
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
        guard let bundled = BundledConfig.load(tenantSlug: slug) else {
            fatalError("Missing bundled tenant configuration for \(slug); run the backend seed to regenerate it")
        }

        let arguments = ProcessInfo.processInfo.arguments
        // Demo builds (Info.plist DemoMode = YES) and the -mock-data argument both use offline demo data.
        let demoBuild = (Bundle.main.object(forInfoDictionaryKey: "DemoMode") as? String)?.uppercased() == "YES"
            || (Bundle.main.object(forInfoDictionaryKey: "DemoMode") as? Bool) == true
        let mockMode = demoBuild || arguments.contains("-mock-data")
        var support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let service: any CinemaService
        if mockMode {
            // Offline demo / UI-test mode: fictional in-memory data, no backend, nothing persisted.
            service = MockCinemaService(config: bundled)
            support = FileManager.default.temporaryDirectory.appendingPathComponent("mock-\(UUID().uuidString)")
            if arguments.contains("-ui-testing") { UIView.setAnimationsEnabled(false) }
        } else {
            let tokens = GuestTokenProvider(baseURL: base, tenantSlug: slug, store: KeychainTokenStore(service: "\(Bundle.main.bundleIdentifier ?? "cinema").session"))
            service = LiveCinemaService(client: APIClient(baseURL: base, tenantSlug: slug, tokens: tokens))
        }
        let model = AppModel(
            service: service,
            configStore: TenantConfigStore(bundled: bundled, cacheDirectory: support),
            tickets: TicketStore(cacheDirectory: support, tenantSlug: slug),
            mediaBaseURL: base,
            isDemo: mockMode,
            accountCacheDirectory: support
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
