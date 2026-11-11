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

    @Test func agesFromBirthdayAndStopsAtDeath() throws {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = TimeZone(identifier: "UTC")!
        let on = cal.date(from: DateComponents(year: 2026, month: 11, day: 11))!
        let p = try APIClient.decoder.decode(Film.Person.self, from: Data(#"{"id":"1","name":"Ellen Pompeo","birthday":"1969-11-10"}"#.utf8))
        #expect(p.age(on: on, calendar: cal) == 57)
        #expect(p.firstName == "Ellen")
        let d = try APIClient.decoder.decode(Film.Person.self, from: Data(#"{"id":"2","name":"X","birthday":"1950-06-01","deathday":"2020-05-31"}"#.utf8))
        #expect(d.age(on: on, calendar: cal) == 69)
        let n = try APIClient.decoder.decode(Film.Person.self, from: Data(#"{"id":"3","name":"Y","birthday":"1950"}"#.utf8))
        #expect(n.age(on: on, calendar: cal) == nil)
    }

    @Test func findsOtherFilmsWithTheSamePerson() throws {
        func film(_ id: String, people: String) throws -> Film {
            try APIClient.decoder.decode(Film.self, from: Data("""
            {"id":"\(id)","slug":"s","title":"T","tagline":null,"synopsis":"s","releaseDate":"2026-11-01","runtimeMinutes":90,"certificate":"PG","genres":[],"director":null,"cast":[],"status":"nowShowing","formats":[],"poster":null,"backdrop":null,"trailers":[],"attributions":[],"people":\(people)}
            """.utf8))
        }
        let a = try film("a", people: #"[{"id":"7","name":"P"}]"#)
        let b = try film("b", people: #"[{"id":"7","name":"P"},{"id":"8","name":"Q"}]"#)
        let c = try film("c", people: #"[{"id":"8","name":"Q"}]"#)
        let person = a.people![0]
        #expect(a.filmsFeaturing(person, in: [c, b, a]).map(\.id) == ["a", "b"])
    }
}
