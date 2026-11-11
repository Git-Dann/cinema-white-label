import Foundation
import Testing
@testable import CinemaCore

@Suite("Promotions")
struct PromotionTests {
    func decode(_ json: String) throws -> [Promotion] {
        try APIClient.decoder.decode([Promotion].self, from: Data(json.utf8))
    }

    @Test func decodesEveryActionKind() throws {
        let list = try decode("""
        [
          {"id":"a","title":"10% off","body":"b","ctaLabel":"Show code","action":{"kind":"voucher","code":"WELCOME10"},"validTo":"2026-12-31T23:59:59.000Z"},
          {"id":"b","title":"Opening","body":"b","ctaLabel":"Book","action":{"kind":"film","filmId":"f1"},"validTo":null},
          {"id":"c","title":"Quiz","body":"b","ctaLabel":"Details","action":{"kind":"link","url":"https://northlight.example/quiz"},"validTo":null},
          {"id":"d","title":"Info","body":"b","ctaLabel":null,"action":{"kind":"none"},"validTo":null}
        ]
        """)
        #expect(list.map(\.action) == [.voucher(code: "WELCOME10"), .film(id: "f1"), .link(URL(string: "https://northlight.example/quiz")!), .none])
        #expect(list[0].validTo != nil)
        #expect(list.map(\.hasButton) == [true, true, true, false])
    }

    @Test func decodesTheBannerPhotoWhenSent() throws {
        let list = try decode("""
        [
          {"id":"a","title":"t","body":"b","ctaLabel":null,"action":{"kind":"none"},"image":{"id":"m1","url":"/v1/media/m1?v=1","width":1200,"height":900,"aspectRatio":1.333,"focalPoint":{"x":0.5,"y":0.5},"dominantColor":"#2D1C17","attribution":"Photo: Unsplash","renditions":[160,342,500,780]}},
          {"id":"b","title":"t","body":"b","ctaLabel":null,"action":{"kind":"none"}}
        ]
        """)
        #expect(list[0].image?.id == "m1")
        #expect(list[1].image == nil)
    }

    @Test func splitsTitlesIntoBannerLines() {
        func lines(_ title: String, film: String? = nil) -> [String] {
            let l = Promotion(id: "x", title: title, body: "b", ctaLabel: nil, action: .none).bannerLines(filmTitle: film)
            return [l.lead, l.headline]
        }
        #expect(lines("New here? 10% off") == ["New here?", "10% OFF"])
        #expect(lines("Tuesdays: £2 off popcorn") == ["Tuesdays: popcorn", "£2 OFF"])
        #expect(lines("Pre-order your snacks") == ["Pre-order your", "SNACKS"])
        #expect(lines("Opening night, booked early", film: "Saltmarsh") == ["Opening night, booked early", "SALTMARSH"])
        #expect(lines("Quiz") == ["", "QUIZ"])
    }

    @Test func unsafeOrUnknownActionsBecomeInformationOnly() throws {
        let list = try decode("""
        [
          {"id":"a","title":"t","body":"b","ctaLabel":"Go","action":{"kind":"link","url":"http://example.com"}},
          {"id":"b","title":"t","body":"b","ctaLabel":"Go","action":{"kind":"link","url":"javascript:alert(1)"}},
          {"id":"c","title":"t","body":"b","ctaLabel":"Go","action":{"kind":"membership","planId":"x"}},
          {"id":"d","title":"t","body":"b","ctaLabel":"Go","action":{"kind":"voucher"}}
        ]
        """)
        #expect(list.allSatisfy { $0.action == .none && !$0.hasButton })
    }

    @Test func roundTripsThroughJSON() throws {
        let original = PreviewFixtures.promotions
        let data = try JSONEncoder().encode(original)
        #expect(try JSONDecoder().decode([Promotion].self, from: data) == original)
    }

    @Test func mockServiceOffersAVoucherItAccepts() async throws {
        let service = MockCinemaService()
        await service.setLatency(.zero)
        let promos = try await service.promotions(venueId: "leeds-riverside")
        guard case .voucher(let code) = promos.first?.action else { Issue.record("Expected a voucher promotion first"); return }
        #expect(code == "WELCOME10")
        guard case .film(let id) = promos.last?.action else { Issue.record("Expected a film promotion"); return }
        #expect(try await service.film(id: id).status == .comingSoon)
    }
}
