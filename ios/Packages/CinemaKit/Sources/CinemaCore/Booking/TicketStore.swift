import Foundation
import Observation

/// The customer's bookings, cached on disk so tickets open offline (e.g. in a
/// basement foyer with no signal). The cache holds only what the ticket screen
/// needs and is cleared for bookings that ended more than 30 days ago.
@MainActor
@Observable
public final class TicketStore {
    public private(set) var bookings: [Booking] = []
    public private(set) var isOffline = false
    /// Why the last refresh failed when it was not a lost connection, e.g. "unauthorised · 401".
    public private(set) var refreshProblem: String?
    public private(set) var lastUpdated: Date?

    private let cacheURL: URL

    public init(cacheDirectory: URL, tenantSlug: String) {
        cacheURL = cacheDirectory.appendingPathComponent("tickets-\(tenantSlug).json")
        if let data = try? Data(contentsOf: cacheURL), let cached = try? APIClient.decoder.decode([Booking].self, from: data) {
            bookings = cached
        }
    }

    public func upcoming(now: Date = Date()) -> [Booking] {
        bookings.filter { $0.isUpcoming(now: now) }.sorted { $0.screening.startsAt < $1.screening.startsAt }
    }

    public func past(now: Date = Date()) -> [Booking] {
        bookings.filter { !$0.isUpcoming(now: now) }.sorted { $0.screening.startsAt > $1.screening.startsAt }
    }

    public func refresh(using service: any CinemaService) async {
        do {
            let fresh = try await service.bookings()
            bookings = fresh
            isOffline = false
            refreshProblem = nil
            lastUpdated = Date()
            persist()
        } catch let e as APIError where e.code != .network {
            // The server answered, so this is not "offline": keep the reason to show and report.
            isOffline = false
            refreshProblem = "\(e.rawCode) · \(e.status)"
        } catch {
            isOffline = true
            refreshProblem = nil
        }
    }

    /// Cancels within the operator's cutoff; the server refunds and frees the seats.
    public func cancel(_ booking: Booking, using service: any CinemaService) async throws {
        let updated = try await service.cancelBooking(id: booking.id)
        insert(updated)
    }

    /// Inserts a just-confirmed booking immediately, before the next refresh.
    public func insert(_ booking: Booking) {
        bookings.removeAll { $0.id == booking.id }
        bookings.append(booking)
        persist()
    }

    private func persist() {
        let cutoff = Date().addingTimeInterval(-30 * 86400)
        let keep = bookings.filter { $0.screening.endsAt > cutoff }
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            try c.encode(f.string(from: date))
        }
        do {
            try FileManager.default.createDirectory(at: cacheURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            try enc.encode(keep).write(to: cacheURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        } catch {}
    }
}
