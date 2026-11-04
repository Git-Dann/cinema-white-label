import Foundation
@testable import CinemaCore

/// Loads the shared fixtures that the backend also uses (shared/fixtures).
enum Fixtures {
    static let repoRoot: URL = URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent() // CinemaCoreTests
        .deletingLastPathComponent() // Tests
        .deletingLastPathComponent() // CinemaKit
        .deletingLastPathComponent() // Packages
        .deletingLastPathComponent() // ios
        .deletingLastPathComponent() // repo root

    static func data(_ relative: String) throws -> Data {
        try Data(contentsOf: repoRoot.appendingPathComponent("shared/fixtures/\(relative)"))
    }

    static func layout(_ name: String) throws -> AuditoriumLayout {
        try JSONDecoder().decode(AuditoriumLayout.self, from: data("layouts/\(name).json"))
    }

    static func config(_ slug: String) throws -> TenantConfig {
        try APIClient.decoder.decode(TenantConfig.self, from: data("tenant-config/\(slug).json"))
    }

    static let pricing = Pricing(
        currency: "GBP",
        bookingFeePerTicketMinor: 95,
        supplements: [],
        ticketTypes: [
            .init(id: "adult", code: "ADULT", name: "Adult", description: nil, requiresProof: false, prices: ["standard": 1250, "premium": 1550, "recliner": 1895, "sofa": 1795]),
            .init(id: "child", code: "CHILD", name: "Child", description: nil, requiresProof: false, prices: ["standard": 899, "premium": 1199, "recliner": nil, "sofa": nil]),
        ]
    )

    static func screening(layout: AuditoriumLayout, id: String = "scr_1") -> ScreeningDetail {
        let start = Date(timeIntervalSince1970: 1_800_000_000)
        return ScreeningDetail(
            id: id, startsAt: start, endsAt: start.addingTimeInterval(7200), localDate: "2027-01-15", formats: ["2D"], attributes: [], onSale: true,
            availability: .init(available: layout.seats.count, total: layout.seats.count, level: .good),
            film: .init(id: "film_1", title: "The Lantern Keeper", certificate: "12A", runtimeMinutes: 128, poster: nil),
            venue: .init(id: "venue_1", name: "Northlight Leeds Riverside", timeZone: "Europe/London"),
            auditorium: .init(id: "aud_1", name: "Screen 1", screenNumber: 1),
            layoutVersion: .init(id: "lv_1", version: 1),
            layout: layout,
            pricing: pricing
        )
    }

    static func snapshot(_ layout: AuditoriumLayout, overrides: [String: SeatAvailability] = [:], hold: AvailabilitySnapshot.HoldRef? = nil) -> AvailabilitySnapshot {
        var seats = Dictionary(uniqueKeysWithValues: layout.seats.map { ($0.id, SeatAvailability.available) })
        for (k, v) in overrides { seats[k] = v }
        return AvailabilitySnapshot(screeningId: "scr_1", serverTime: Date(), version: 1, seats: seats, yourHold: hold)
    }
}

