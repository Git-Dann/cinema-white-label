import Foundation
import Testing
@testable import CinemaCore

@Suite("App update status")
struct AppStatusTests {
    let store = URL(string: "https://apps.apple.com/app/id123456789")!

    @Test func decodesTheServerAnswer() throws {
        let json = #"{"status":"update-available","latestVersion":"1.4.0","minimumVersion":"1.2","message":"Adds Apple Pay.","storeUrl":"https://apps.apple.com/app/id123456789"}"#
        let s = try APIClient.decoder.decode(AppStatus.self, from: Data(json.utf8))
        #expect(s.status == .updateAvailable && s.latestVersion == "1.4.0" && s.storeUrl == store)
        let bare = try APIClient.decoder.decode(AppStatus.self, from: Data(#"{"status":"current","latestVersion":"1.4.0","minimumVersion":"1.2","message":null,"storeUrl":null}"#.utf8))
        #expect(bare.status == .current && bare.storeUrl == nil)
    }

    @Test func blocksOnlyWhenTheServerSaysSo() {
        let required = AppStatus(status: .updateRequired, latestVersion: "1.4.0", minimumVersion: "1.2", storeUrl: store)
        #expect(UpdatePrompt.decide(required, dismissedVersion: "1.4.0") == .require(required))
        // Offline or an older server: never block anyone.
        #expect(UpdatePrompt.decide(nil, dismissedVersion: nil) == .none)
        #expect(UpdatePrompt.decide(AppStatus(status: .current, latestVersion: "1.4.0", minimumVersion: "1.2"), dismissedVersion: nil) == .none)
        #expect(UpdatePrompt.require(required).body.contains("Your tickets are safe"))
    }

    @Test func suggestsEachNewVersionOnce() {
        let available = AppStatus(status: .updateAvailable, latestVersion: "1.4.0", minimumVersion: "1.2", message: "Adds Apple Pay.", storeUrl: store)
        #expect(UpdatePrompt.decide(available, dismissedVersion: nil) == .suggest(available))
        #expect(UpdatePrompt.decide(available, dismissedVersion: "1.3.0") == .suggest(available))
        #expect(UpdatePrompt.decide(available, dismissedVersion: "1.4.0") == .none)
        #expect(UpdatePrompt.suggest(available).body == "Adds Apple Pay.")
        // Nothing to tap without a store link (TestFlight builds), so stay quiet.
        var noLink = available; noLink.storeUrl = nil
        #expect(UpdatePrompt.decide(noLink, dismissedVersion: nil) == .none)
    }

    @Test func mockServiceNeverAsksForAnUpdate() async throws {
        let mock = MockCinemaService()
        #expect(try await mock.appStatus(version: "0.0.1") == nil)
    }
}
