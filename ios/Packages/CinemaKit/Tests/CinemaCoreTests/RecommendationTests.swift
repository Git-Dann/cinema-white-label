import Foundation
import Testing
@testable import CinemaCore

@Suite struct RecommendationTests {
    private let json = """
    {"basis":{"bookingsUsed":120,"personal":true},
     "recommendations":[
       {"film":{"id":"F2","slug":"two","title":"Two","certificate":"12A","genres":["Drama"],"posterUrl":null},"score":0.4,"reason":"People who booked One also booked this"},
       {"film":{"id":"missing","slug":"x","title":"Gone","certificate":"15","genres":[],"posterUrl":null},"score":0.3,"reason":"Similar"},
       {"film":{"id":"F3","slug":"three","title":"Three","certificate":"PG","genres":[],"posterUrl":null},"score":0.2,"reason":"Like One: Drama"},
       {"film":{"id":"F2","slug":"two","title":"Two","certificate":"12A","genres":[],"posterUrl":null},"score":0.1,"reason":"dupe"}
     ]}
    """

    private func films() -> [Film] {
        let base = PreviewFixtures.films[0]
        return ["F1", "F2", "F3"].map { id in var f = base; f.id = id; return f }
    }

    @Test func decodesServerShapeIgnoringExtraFields() throws {
        let list = try JSONDecoder().decode(RecommendationList.self, from: Data(json.utf8))
        #expect(list.basis.personal)
        #expect(list.recommendations.count == 4)
        #expect(list.recommendations[0].reason == "People who booked One also booked this")
    }

    @Test func resolvesInServerOrderDroppingUnknownBookedAndDuplicates() throws {
        let list = try JSONDecoder().decode(RecommendationList.self, from: Data(json.utf8))
        let all = list.resolved(against: films())
        #expect(all.map(\.film.id) == ["F2", "F3"])
        #expect(all[1].reason == "Like One: Drama")
        #expect(list.resolved(against: films(), excluding: ["F2"]).map(\.film.id) == ["F3"])
        #expect(list.resolved(against: films(), limit: 1).count == 1)
    }

    @Test func shortensReasonsForPosterCaptions() throws {
        let f = PreviewFixtures.films[0]
        func cap(_ r: String) -> String { RecommendationList.Resolved(film: f, reason: r).caption }
        #expect(cap("People who booked Tidewater also booked this") == "Booked by fans of Tidewater")
        #expect(cap("Like Tidewater: Drama, Thriller") == "Like Tidewater")
        #expect(cap("Popular at your cinema right now") == "Popular right now")
        #expect(cap("Because you booked Tidewater") == "Because you booked Tidewater")
    }

    @Test func subtitleSaysWhetherPicksArePersonal() {
        #expect(RecommendationList(basis: .init(personal: true), recommendations: []).subtitle == "Picked from what you've booked")
        #expect(RecommendationList.empty.subtitle == "Popular at your cinema")
    }
}
