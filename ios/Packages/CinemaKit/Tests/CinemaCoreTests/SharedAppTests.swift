import Foundation
import Testing
@testable import CinemaCore

@Suite("Shared Seatfold app")
struct SharedAppTests {
    let km: (Double) -> String = { String(format: "%.1f km", $0) }

    func entry(_ venues: [DirectoryEntry.VenueSummary]) -> DirectoryEntry {
        DirectoryEntry(slug: "kestrel", name: "Kestrel Picturehouse", wordmark: "Kestrel", accent: .init(light: "#7A2E2E", dark: "#F2A65A"), venues: venues)
    }

    @Test func decodesTheDirectory() throws {
        let json = ##"[{"slug":"kestrel","name":"Kestrel Picturehouse","wordmark":"Kestrel","logoLightUrl":null,"logoDarkUrl":"/media/k.png","accent":{"light":"#7A2E2E","dark":"#F2A65A"},"venues":[{"name":"Kestrel York","city":"York","distanceKm":2.4}]}]"##
        let list = try APIClient.decoder.decode([DirectoryEntry].self, from: Data(json.utf8))
        #expect(list.first?.slug == "kestrel" && list.first?.venues.first?.distanceKm == 2.4 && list.first?.logoDarkUrl == "/media/k.png")
    }

    @Test func describesWhereAnOperatorIs() {
        #expect(entry([.init(name: "Kestrel York", city: "York")]).summary(distance: km) == "York")
        #expect(entry([.init(name: "Kestrel York", city: "York", distanceKm: 2.4)]).summary(distance: km) == "York · 2.4 km")
        let chain = entry([.init(name: "A", city: "Leeds", distanceKm: 1.2), .init(name: "B", city: "York", distanceKm: 30), .init(name: "C", city: "Leeds", distanceKm: 31)])
        #expect(chain.summary(distance: km) == "3 cinemas · nearest Leeds, 1.2 km")
        var noLoc = chain
        noLoc.venues = noLoc.venues.map { var v = $0; v.distanceKm = nil; return v }
        #expect(noLoc.summary(distance: km) == "3 cinemas · Leeds, York")
        let many = entry(["Leeds", "York", "Hull", "Ripon"].map { .init(name: $0, city: $0) })
        #expect(many.summary(distance: km) == "4 cinemas · Leeds, York, Hull and more")
    }

    @Test func searchesLikeTheServer() {
        let e = entry([.init(name: "Kestrel Riverside", city: "York")])
        #expect(e.matches("") && e.matches("kestrel") && e.matches("YORK") && e.matches("river side"))
        #expect(!e.matches("Leeds"))
    }

    @Test func readsTheBuildModeFromInfoPlist() {
        #expect(AppMode.from(info: ["TenantSlug": "northlight", "AppMode": "branded"]) == .branded(slug: "northlight"))
        #expect(AppMode.from(info: ["TenantSlug": "northlight"]) == .branded(slug: "northlight"))
        #expect(AppMode.from(info: ["TenantSlug": "", "AppMode": "shared"]) == .shared)
        #expect(AppMode.from(info: [:]) == .shared)
    }

    @Test func remembersTheChoiceAndOpensOfflineInThatTheme() throws {
        let suite = "shared-app-\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        let group = UserDefaults(suiteName: suite + ".group")!
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = OperatorChoiceStore(defaults: defaults, directory: dir, shared: group)
        #expect(store.slug == nil)

        // An operator whose config isn't in the app: the saved copy is used next launch.
        var other = try Fixtures.config("kestrel")
        other.tenant.slug = "riverside"
        other.tenant.name = "Riverside Cinema"
        try store.choose(other)
        #expect(store.slug == "riverside")
        #expect(group.string(forKey: OperatorChoiceStore.key) == "riverside")
        #expect(store.seed(for: "riverside")?.tenant.name == "Riverside Cinema")
        // Demo operators always start from the copy shipped in the app.
        #expect(store.seed(for: "northlight")?.tenant.slug == "northlight")
        #expect(store.seed(for: "never-chosen") == nil)

        store.clear()
        #expect(store.slug == nil && group.string(forKey: OperatorChoiceStore.key) == nil)
        // Switching back is instant: the saved configuration stays.
        #expect(store.seed(for: "riverside") != nil)
    }

    @Test func refusesAConfigurationTheAppCannotShow() throws {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        let store = OperatorChoiceStore(defaults: UserDefaults(suiteName: "reject-\(UUID().uuidString)")!, directory: dir)
        var broken = try Fixtures.config("kestrel")
        broken.schemaVersion = 999
        #expect(throws: OperatorChoiceStore.ChoiceError.self) { try store.choose(broken) }
        #expect(store.slug == nil)
    }

    @Test func demoDirectoryListsTheBundledOperators() async throws {
        let demo = DemoDirectoryService()
        let all = try await demo.operators(query: nil, latitude: nil, longitude: nil)
        #expect(all.map(\.slug) == ["northlight", "kestrel"])
        #expect(try await demo.operators(query: "kestrel", latitude: nil, longitude: nil).map(\.slug) == ["kestrel"])
        #expect(try await demo.config(slug: "kestrel").tenant.slug == "kestrel")
    }
}
