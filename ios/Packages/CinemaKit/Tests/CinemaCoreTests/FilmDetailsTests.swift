import Foundation
import Testing
@testable import CinemaCore

@Suite("Film details")
struct FilmDetailsTests {
    private let base = """
    "id":"f1","slug":"f","title":"Film","tagline":null,"synopsis":"s","releaseDate":"2026-11-01","runtimeMinutes":120,
    "certificate":"12A","genres":["Drama"],"director":"D","cast":["A"],"status":"nowShowing","formats":[],
    "poster":null,"backdrop":null,"trailers":[],"attributions":[]
    """

    @Test func decodesCastCrewAboutAndParentsGuide() throws {
        let json = """
        {\(base),
         "logo":{"id":"l","url":"/v1/media/l?v=1","width":500,"height":200,"aspectRatio":2.5,"focalPoint":{"x":0.5,"y":0.5},"dominantColor":null,"attribution":"Image: TMDB","renditions":[160,342,500]},
         "people":[{"id":"501","name":"Actor A","character":"Hero","biography":"Born somewhere.","photo":{"id":"p","url":"https://image.tmdb.org/t/p/w185/a.jpg","width":185,"height":278,"aspectRatio":0.665,"focalPoint":{"x":0.5,"y":0.3},"dominantColor":null,"attribution":"Image: TMDB","renditions":[]}},
                   {"id":"502","name":"Actor B","character":null,"biography":null,"photo":null}],
         "crew":[{"name":"D","job":"Director"},{"name":"W1","job":"Screenplay"},{"name":"W2","job":"Screenplay"}],
         "about":{"originalTitle":null,"spokenLanguages":["English"],"originCountries":["United Kingdom"],"productionCompanies":["Studio"],"status":"Released","budget":null,"keywords":["heist"]},
         "contentAdvice":{"certificate":"12A","meaning":"12 and over, or with an adult","items":[{"category":"Language","level":"Strong","text":"strong language"},{"category":"Violence","level":"Moderate","text":"moderate violence"}]}}
        """
        let film = try APIClient.decoder.decode(Film.self, from: Data(json.utf8))
        #expect(film.people?.map(\.name) == ["Actor A", "Actor B"])
        #expect(film.people?.first?.photo?.url(forPixelWidth: 300, base: URL(string: "https://api.example")!)?.host == "image.tmdb.org")
        #expect(film.crewByJob.map(\.job) == ["Director", "Screenplay"])
        #expect(film.crewByJob.last?.names == ["W1", "W2"])
        #expect(film.contentAdvice?.items.map(\.level) == [.strong, .moderate])
        #expect(film.about?.keywords == ["heist"])
        #expect(film.logo?.aspectRatio == 2.5)
    }

    @Test func olderPayloadsWithoutDetailsStillDecode() throws {
        let film = try APIClient.decoder.decode(Film.self, from: Data("{\(base)}".utf8))
        #expect(film.people == nil)
        #expect(film.contentAdvice == nil)
        #expect(film.crewByJob.isEmpty)
    }
}
