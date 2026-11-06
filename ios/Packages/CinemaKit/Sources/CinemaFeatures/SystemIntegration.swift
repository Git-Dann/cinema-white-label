import AppIntents
import CoreSpotlight
import Observation
import SwiftUI
import UniformTypeIdentifiers
import CinemaCore

/// Routes system entry points (App Intents, Spotlight, deep links) to a tab.
@MainActor
@Observable
public final class AppNavigator {
    public static let shared = AppNavigator()
    public enum Destination: Hashable { case home, films, cinemas, food, tickets, account }
    public var requested: Destination?
    public var requestedBookingId: String?
}

// MARK: - App Intents (Siri, Shortcuts, Spotlight actions)
// Intents only navigate or show information. Nothing is purchased or reserved
// through Siri; booking always needs the customer's explicit action in the app.

struct ShowNextTicketIntent: AppIntent {
    static let title: LocalizedStringResource = "Show my next cinema ticket"
    static let description = IntentDescription("Opens your next upcoming ticket.")
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        AppNavigator.shared.requested = .tickets
        return .result()
    }
}

struct FindCinemasIntent: AppIntent {
    static let title: LocalizedStringResource = "Find cinemas near me"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        AppNavigator.shared.requested = .cinemas
        return .result()
    }
}

struct BrowseFilmsIntent: AppIntent {
    static let title: LocalizedStringResource = "Show films at my cinema"
    static let openAppWhenRun = true

    @MainActor
    func perform() async throws -> some IntentResult {
        AppNavigator.shared.requested = .films
        return .result()
    }
}

public struct CinemaShortcuts: AppShortcutsProvider {
    public static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: ShowNextTicketIntent(), phrases: ["Show my ticket in \(.applicationName)", "Show my next film in \(.applicationName)"], shortTitle: "Next ticket", systemImageName: "ticket")
        AppShortcut(intent: FindCinemasIntent(), phrases: ["Find a cinema with \(.applicationName)"], shortTitle: "Nearby cinemas", systemImageName: "mappin.and.ellipse")
        AppShortcut(intent: BrowseFilmsIntent(), phrases: ["What's on at \(.applicationName)"], shortTitle: "What's on", systemImageName: "film")
    }
}

// MARK: - Spotlight

/// Indexes upcoming bookings and favourite cinemas on device. Admission codes are
/// never indexed; expired bookings are removed.
enum SpotlightIndexer {
    static let bookingDomain = "bookings"
    static let venueDomain = "venues"

    static func index(upcoming: [Booking], favourites: [Venue], formatters: Formatters) {
        let index = CSSearchableIndex.default()
        index.deleteSearchableItems(withDomainIdentifiers: [bookingDomain, venueDomain]) { _ in
            var items: [CSSearchableItem] = upcoming.map { b in
                let attrs = CSSearchableItemAttributeSet(contentType: .content)
                attrs.title = b.film.title
                attrs.contentDescription = "\(formatters.shortDate(b.screening.startsAt, timeZone: b.venue.timeZone)) \(formatters.time(b.screening.startsAt, timeZone: b.venue.timeZone)) · \(b.venue.name) · Seats \(b.seatSummary)"
                let item = CSSearchableItem(uniqueIdentifier: "booking:\(b.id)", domainIdentifier: bookingDomain, attributeSet: attrs)
                item.expirationDate = b.screening.endsAt
                return item
            }
            items += favourites.map { v in
                let attrs = CSSearchableItemAttributeSet(contentType: .content)
                attrs.title = v.name
                attrs.contentDescription = "\(v.address.line1), \(v.address.city)"
                return CSSearchableItem(uniqueIdentifier: "venue:\(v.id)", domainIdentifier: venueDomain, attributeSet: attrs)
            }
            index.indexSearchableItems(items)
        }
    }

    @MainActor
    static func handle(_ activity: NSUserActivity) {
        guard let id = activity.userInfo?[CSSearchableItemActivityIdentifier] as? String else { return }
        if id.hasPrefix("booking:") {
            AppNavigator.shared.requestedBookingId = String(id.dropFirst(8))
            AppNavigator.shared.requested = .tickets
        } else if id.hasPrefix("venue:") {
            AppNavigator.shared.requested = .cinemas
        }
    }
}
