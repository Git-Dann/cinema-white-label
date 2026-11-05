import Foundation
import Observation
import CinemaCore

/// App-wide state shared by the five tabs. Created once at launch.
@MainActor
@Observable
public final class AppModel {
    public let service: any CinemaService
    public let configStore: TenantConfigStore
    public let tickets: TicketStore
    public let analytics: AnalyticsRecorder
    public let mediaBaseURL: URL
    /// Demo builds use mock data; Live Activities may start early and the widget is labelled demo.
    public let isDemo: Bool
    /// App Group shared with the widget extension (from Info.plist).
    public let widgetStore: WidgetSnapshotStore

    public private(set) var venues: [Venue] = []
    public private(set) var nowShowing: [Film] = []
    public private(set) var comingSoon: [Film] = []
    public private(set) var loadError: String?
    public private(set) var isLoading = false

    /// Customer's chosen cinema, remembered between launches.
    public var selectedVenueID: String? {
        didSet {
            UserDefaults.standard.set(selectedVenueID, forKey: "selectedVenue.\(config.tenant.slug)")
            if let id = selectedVenueID, id != oldValue { Task { await analytics.record(.cinemaSelected, ["venueId": id]) } }
        }
    }

    public init(service: any CinemaService, configStore: TenantConfigStore, tickets: TicketStore, mediaBaseURL: URL, isDemo: Bool = false,
                appGroup: String = Bundle.main.infoDictionary?["AppGroup"] as? String ?? "") {
        self.isDemo = isDemo
        self.widgetStore = WidgetSnapshotStore(suiteName: appGroup)
        self.service = service
        self.configStore = configStore
        self.tickets = tickets
        self.mediaBaseURL = mediaBaseURL
        self.analytics = AnalyticsRecorder(service: service)
        self.selectedVenueID = UserDefaults.standard.string(forKey: "selectedVenue.\(configStore.config.tenant.slug)")
    }

    public var config: TenantConfig { configStore.config }
    public var formatters: Formatters { Formatters(locale: Locale(identifier: config.tenant.locale.replacingOccurrences(of: "-", with: "_")), currencyCode: config.tenant.currency) }
    public var selectedVenue: Venue? { venues.first { $0.id == selectedVenueID } }
    public var favouriteVenues: [Venue] { venues.filter(\.isFavourite) }

    public func start() async {
        await analytics.setEnabled(UserDefaults.standard.object(forKey: "analyticsEnabled") as? Bool ?? true)
        await analytics.record(.appOpened)
        async let config: Void = refreshConfig()
        async let content: Void = loadContent()
        async let tickets: Void = self.tickets.refresh(using: service)
        _ = await (config, content, tickets)
    }

    public func refreshConfig() async {
        let before = configStore.lastRejection
        await configStore.refresh(using: service)
        if let reason = configStore.lastRejection, reason != before {
            await analytics.record(.themeLoadFailed, ["reason": String(reason.prefix(120))])
        }
    }

    public func loadContent() async {
        isLoading = true
        defer { isLoading = false }
        do {
            async let n = service.films(status: .nowShowing, query: nil)
            async let c = service.films(status: .comingSoon, query: nil)
            async let v = service.venues(latitude: nil, longitude: nil, query: nil)
            (nowShowing, comingSoon, venues) = try await (n, c, v)
            loadError = nil
            if selectedVenueID == nil || selectedVenue == nil { selectedVenueID = favouriteVenues.first?.id ?? venues.first?.id }
        } catch {
            loadError = (error as? APIError)?.message ?? "We couldn't load films right now."
        }
    }

    public func reloadVenues(near latitude: Double? = nil, longitude: Double? = nil, query: String? = nil) async throws -> [Venue] {
        let list = try await service.venues(latitude: latitude, longitude: longitude, query: query)
        if latitude == nil, query == nil { venues = list }
        return list
    }

    public func toggleFavourite(_ venue: Venue) async {
        let target = !venue.isFavourite
        if let i = venues.firstIndex(where: { $0.id == venue.id }) { venues[i].isFavourite = target }
        do {
            try await service.setFavourite(venueId: venue.id, target)
            if target { await analytics.record(.cinemaFavourited, ["venueId": venue.id]) }
        } catch {
            if let i = venues.firstIndex(where: { $0.id == venue.id }) { venues[i].isFavourite = !target }
        }
    }

    public func film(id: String) -> Film? { (nowShowing + comingSoon).first { $0.id == id } }
}
