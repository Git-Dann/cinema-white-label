import SwiftUI
import UIKit
import Security
import CinemaCore
import CinemaFeatures

/// App entry point. Everything operator-specific at build time comes from the
/// xcconfig generated from fleet/brands (bundle ID, icon, TENANT_SLUG, APP_MODE);
/// everything else is runtime tenant configuration from the backend.
///
/// Two modes from one codebase:
/// - branded: one operator's own app, fixed to TENANT_SLUG.
/// - shared: the Seatfold app. The customer picks an operator and the app takes on its theme.
@main
struct CinemaApp: App {
    @State private var branded: AppModel?
    private let shared: (directory: any DirectoryService, choices: OperatorChoiceStore)?
    private let factory: AppFactory

    init() {
        let info = Bundle.main.infoDictionary ?? [:]
        let base = URL(string: info["APIBaseURL"] as? String ?? "http://localhost:3000/")!
        let arguments = ProcessInfo.processInfo.arguments
        // Demo builds (Info.plist DemoMode = YES) and the -mock-data argument both use offline demo data.
        let demoBuild = (info["DemoMode"] as? String)?.uppercased() == "YES" || (info["DemoMode"] as? Bool) == true
        let mockMode = demoBuild || arguments.contains("-mock-data")
        if mockMode && arguments.contains("-ui-testing") { UIView.setAnimationsEnabled(false) }
        let support = mockMode
            ? FileManager.default.temporaryDirectory.appendingPathComponent("mock-\(UUID().uuidString)")
            : FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        let mode = AppMode.from(info: info)
        let factory = AppFactory(baseURL: base, mockMode: mockMode, support: support, fleetBrand: (info["FleetBrand"] as? String).flatMap { $0.isEmpty ? nil : $0 }, perOperatorSession: mode == .shared)
        self.factory = factory

        switch mode {
        case .branded(let slug):
            // Bundled known-good configuration so the app always has a valid theme offline.
            guard let bundled = BundledConfig.load(tenantSlug: slug) else {
                fatalError("Missing bundled tenant configuration for \(slug); run the backend seed to regenerate it")
            }
            shared = nil
            _branded = State(initialValue: factory.make(bundled))
        case .shared:
            let group = (info["AppGroup"] as? String).flatMap(UserDefaults.init(suiteName:))
            let choices = OperatorChoiceStore(directory: support.appendingPathComponent("operators", isDirectory: true), shared: group)
            let directory: any DirectoryService = mockMode ? DemoDirectoryService() : LiveDirectoryService(baseURL: base)
            shared = (directory, choices)
        }
    }

    var body: some Scene {
        WindowGroup {
            if let shared {
                SharedAppView(directory: shared.directory, choices: shared.choices, makeApp: factory.make)
            } else if let branded {
                RootView(app: branded)
            }
        }
    }
}

/// Builds the app for one operator from a starting configuration.
struct AppFactory {
    let baseURL: URL
    let mockMode: Bool
    let support: URL
    let fleetBrand: String?
    /// The shared app keeps a separate session per operator; a branded app keeps its existing one.
    let perOperatorSession: Bool

    @MainActor
    func make(_ seed: TenantConfig) -> AppModel {
        let slug = seed.tenant.slug
        let service: any CinemaService
        if mockMode {
            // Offline demo / UI-test mode: fictional in-memory data, no backend, nothing persisted.
            service = MockCinemaService(config: seed)
        } else {
            let keychain = "\(Bundle.main.bundleIdentifier ?? "cinema").session" + (perOperatorSession ? ".\(slug)" : "")
            let tokens = GuestTokenProvider(baseURL: baseURL, tenantSlug: slug, store: KeychainTokenStore(service: keychain))
            service = LiveCinemaService(client: APIClient(baseURL: baseURL, tenantSlug: slug, tokens: tokens), fleetBrand: fleetBrand)
        }
        return AppModel(
            service: service,
            configStore: TenantConfigStore(bundled: seed, cacheDirectory: support),
            tickets: TicketStore(cacheDirectory: support, tenantSlug: slug),
            mediaBaseURL: baseURL,
            isDemo: mockMode,
            accountCacheDirectory: support
        )
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
