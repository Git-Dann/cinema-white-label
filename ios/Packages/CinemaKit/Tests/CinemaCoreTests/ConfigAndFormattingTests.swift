import Foundation
import Testing
@testable import CinemaCore

@MainActor
@Suite("Tenant configuration")
struct TenantConfigTests {
    func tempDir() -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
    }

    @Test func decodesPublishedFixturesForBothOperators() throws {
        let n = try Fixtures.config("northlight")
        let k = try Fixtures.config("kestrel")
        #expect(n.tenant.slug == "northlight" && n.theme.themeId == .midnight)
        #expect(k.theme.themeId == .classic)
        #expect(n.theme.dark.background != k.theme.dark.background)
        #expect(n.branding.palette.accent.dark == "#2DD4BF")
    }

    @Test func fixturesPassClientSideContrastValidation() throws {
        for slug in ["northlight", "kestrel"] {
            let c = try Fixtures.config(slug)
            #expect(TenantConfigStore.rejectionReason(c, expectedTenant: slug) == nil)
        }
    }

    @Test func contrastRatioMatchesWCAG() {
        #expect(abs(ContrastValidator.ratio("#000000", "#FFFFFF")! - 21) < 0.001)
        #expect(abs(ContrastValidator.ratio("#767676", "#FFFFFF")! - 4.54) < 0.01)
    }

    @Test func keepsKnownGoodConfigWhenRemoteIsUnreadable() async throws {
        let good = try Fixtures.config("northlight")
        var bad = good
        bad.version = good.version + 1
        bad.theme.dark.textPrimary = bad.theme.dark.background
        let svc = FakeService()
        svc.config = bad
        let store = TenantConfigStore(bundled: good, cacheDirectory: tempDir(), defaults: UserDefaults(suiteName: UUID().uuidString)!)
        let adopted = await store.refresh(using: svc)
        #expect(adopted == false)
        #expect(store.config.version == good.version)
        #expect(store.lastRejection?.contains("contrast") == true)
    }

    @Test func rejectsAnotherOperatorsConfig() async throws {
        let store = TenantConfigStore(bundled: try Fixtures.config("northlight"), cacheDirectory: tempDir(), defaults: UserDefaults(suiteName: UUID().uuidString)!)
        let svc = FakeService()
        var other = try Fixtures.config("kestrel")
        other.version = 99
        svc.config = other
        #expect(await store.refresh(using: svc) == false)
        #expect(store.config.tenant.slug == "northlight")
    }

    @Test func adoptsAndCachesNewerValidConfig() async throws {
        let dir = tempDir()
        let defaults = UserDefaults(suiteName: UUID().uuidString)!
        let good = try Fixtures.config("northlight")
        var newer = good
        newer.version = good.version + 1
        newer.branding.wordmark = "Northlight Winter"
        let svc = FakeService()
        svc.config = newer
        let store = TenantConfigStore(bundled: good, cacheDirectory: dir, defaults: defaults)
        #expect(await store.refresh(using: svc))
        #expect(store.source == .remote)
        // A fresh launch starts from the cached known-good config, not the bundled one.
        let relaunched = TenantConfigStore(bundled: good, cacheDirectory: dir, defaults: defaults)
        #expect(relaunched.source == .cached)
        #expect(relaunched.config.branding.wordmark == "Northlight Winter")
    }

    @Test func increaseContrastPrefersHighContrastTheme() throws {
        var c = try Fixtures.config("northlight")
        var hc = c.theme
        hc.themeId = .highContrast
        hc.name = "High Contrast"
        c.alternateThemes = [hc]
        let store = TenantConfigStore(bundled: c, cacheDirectory: tempDir(), defaults: UserDefaults(suiteName: UUID().uuidString)!)
        #expect(store.activeTheme(increasedContrast: true).themeId == .highContrast)
        #expect(store.activeTheme(increasedContrast: false).themeId == .midnight)
    }
}

@Suite("Formatting and API errors")
struct FormattingTests {
    @Test func formatsMoneyInMinorUnits() {
        let f = Formatters()
        #expect(f.money(1250) == "£12.50")
        #expect(f.money(0) == "£0.00")
    }

    @Test func showsTimesInTheCinemaTimeZone() {
        let f = Formatters()
        let summer = Date(timeIntervalSince1970: 1_782_930_600) // 2026-07-01T18:30:00Z
        #expect(f.time(summer, timeZone: "Europe/London") == "19:30")
        #expect(f.time(summer, timeZone: "UTC") == "18:30")
        #expect(f.runtime(135) == "2h 15m")
        #expect(f.spokenRuntime(135) == "2 hours 15 minutes")
        #expect(f.countdown(461) == "7:41")
    }

    @Test func decodesServerErrorEnvelope() {
        let body = Data(#"{"error":{"code":"seats_unavailable","message":"Some seats are no longer available","details":{"seatIds":["F-8"]}}}"#.utf8)
        let e = APIError.from(status: 409, data: body)
        #expect(e.code == .seatsUnavailable)
        #expect(e.seatIds == ["F-8"])
        let rules = Data(#"{"error":{"code":"seat_rules","message":"Sofa","details":{"violations":[{"code":"group_incomplete","message":"Sofa seats are sold in pairs","seatIds":["E-1","E-2"]}]}}}"#.utf8)
        let r = APIError.from(status: 422, data: rules)
        #expect(r.code == .seatRules && r.violations.first?.code == "group_incomplete" && r.seatIds == ["E-1", "E-2"])
    }

    @Test func picksImageRenditionsWithoutUpscaling() {
        let img = ImageRef(id: "a", url: "/v1/media/a?v=1", width: 800, height: 1200, aspectRatio: 0.667, focalPoint: .init(x: 0.5, y: 0.5), dominantColor: nil, attribution: nil, renditions: [160, 342, 500, 780])
        let base = URL(string: "http://localhost:3000/")!
        #expect(img.url(forPixelWidth: 300, base: base)?.absoluteString == "http://localhost:3000/v1/media/a?v=1&w=342")
        #expect(img.url(forPixelWidth: 2000, base: base)?.absoluteString == "http://localhost:3000/v1/media/a?v=1&w=780")
    }

    @Test func walletDemoStateIsNeverAPass() throws {
        let r = try JSONDecoder().decode(WalletPassResponse.self, from: Data(#"{"status":"demo_unsigned","serialNumber":"s1","message":"Needs a certificate","passJsonPreview":{}}"#.utf8))
        guard case .demoUnsigned(let serial, _) = r else { Issue.record("expected demo state"); return }
        #expect(serial == "s1")
    }
}

@Suite("Bundled configuration")
struct BundledConfigTests {
    @Test func bothOperatorsShipAValidFallbackConfig() {
        for slug in ["northlight", "kestrel"] {
            let c = BundledConfig.load(tenantSlug: slug)
            #expect(c?.tenant.slug == slug)
            #expect(c.map { TenantConfigStore.rejectionReason($0, expectedTenant: slug) } == .some(nil))
        }
        #expect(BundledConfig.load(tenantSlug: "nope") == nil)
    }
}
