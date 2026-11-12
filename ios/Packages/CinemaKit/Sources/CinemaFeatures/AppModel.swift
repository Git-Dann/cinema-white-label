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
    /// Live offers for the selected cinema. Empty hides the Offers section.
    public private(set) var promotions: [Promotion] = []
    public private(set) var recommendations: RecommendationList = .empty
    /// Points balance and history. `program == nil` hides rewards.
    public private(set) var loyalty: LoyaltySummary = .none
    public private(set) var membership: Membership?
    /// Plans on sale. Empty (or the memberships feature off) hides memberships.
    public private(set) var membershipPlans: [MembershipPlan] = []
    public private(set) var loadError: String?
    public private(set) var isLoading = false

    /// Customer's chosen cinema, remembered between launches.
    public var selectedVenueID: String? {
        didSet {
            UserDefaults.standard.set(selectedVenueID, forKey: "selectedVenue.\(config.tenant.slug)")
            if let id = selectedVenueID, id != oldValue {
                Task { await analytics.record(.cinemaSelected, ["venueId": id]) }
                Task { await loadPromotions() }
            }
        }
    }

    /// Last rewards and membership state, so the Account cards appear instantly.
    private let accountStore: AccountSnapshotStore?

    public init(service: any CinemaService, configStore: TenantConfigStore, tickets: TicketStore, mediaBaseURL: URL, isDemo: Bool = false,
                accountCacheDirectory: URL? = nil,
                appGroup: String = Bundle.main.infoDictionary?["AppGroup"] as? String ?? "") {
        self.isDemo = isDemo
        let store = accountCacheDirectory.map { AccountSnapshotStore(cacheDirectory: $0, tenantSlug: configStore.config.tenant.slug) }
        self.accountStore = store
        if let cached = store?.load() {
            loyalty = cached.loyalty
            membership = cached.membership
            membershipPlans = cached.membershipPlans
        }
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
        async let tickets: Void = refreshTickets()
        // Load rewards and membership up front so Account is ready before it is opened.
        async let account: Void = loadAccount()
        _ = await (config, content, tickets, account)
    }

    /// Refreshes tickets, retrying once after a moment (the API can be waking up), and
    /// reports a failure that isn't a lost connection so it shows in the portal.
    public func refreshTickets() async {
        await tickets.refresh(using: service)
        guard tickets.isOffline || tickets.refreshProblem != nil else { return }
        try? await Task.sleep(for: .seconds(2))
        await tickets.refresh(using: service)
        if let problem = tickets.refreshProblem {
            await analytics.record(.ticketsRefreshFailed, ["reason": String(problem.prefix(120))])
        }
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
            async let promos: Void = loadPromotions()
            async let recs: Void = loadRecommendations()
            _ = await (promos, recs)
        } catch {
            loadError = (error as? APIError)?.message ?? "We couldn't load films right now."
        }
    }

    /// Rewards and membership for the Account tab. Optional content: failures leave sections hidden.
    public func loadAccount() async {
        let service = self.service
        let wantsPlans = config.features.memberships
        async let l = try? service.loyalty()
        // `try?` would flatten "failed" and "no membership" together; keep them apart.
        async let m = Self.fetchMembership(service)
        async let p: [MembershipPlan]? = wantsPlans ? (try? service.membershipPlans()) : []
        let (loyaltyResult, membershipResult, plansResult) = await (l, m, p)
        let current = AccountSnapshot(loyalty: loyalty, membership: membership, membershipPlans: membershipPlans)
        let next = current.merging(loyalty: loyaltyResult, membership: membershipResult, plans: plansResult)
        guard next != current else { return }
        loyalty = next.loyalty
        membership = next.membership
        membershipPlans = next.membershipPlans
        accountStore?.save(next)
    }

    /// `.some(nil)` means no membership; `nil` means the request failed.
    nonisolated private static func fetchMembership(_ service: any CinemaService) async -> Membership?? {
        do { return .some(try await service.myMembership()) } catch { return nil }
    }

    /// Buys or renews a plan. The key is per attempt so a retried tap is not charged twice.
    public func buyMembership(_ plan: MembershipPlan, simulateDecline: Bool = false, idempotencyKey: String) async throws {
        membership = try await service.purchaseMembership(planId: plan.id, simulateDecline: simulateDecline, idempotencyKey: idempotencyKey)
        accountStore?.save(AccountSnapshot(loyalty: loyalty, membership: membership, membershipPlans: membershipPlans))
        Task { await analytics.record(.membershipEngaged, ["action": "purchased"]) }
    }

    /// Offers are optional content: a failure leaves the section hidden rather than erroring the home screen.
    public func loadPromotions() async {
        promotions = (try? await service.promotions(venueId: selectedVenueID)) ?? []
    }

    /// Optional content: a failure leaves the "You might like" row hidden.
    public func loadRecommendations() async {
        recommendations = (try? await service.recommendations()) ?? .empty
    }

    /// Picks the app can show, leaving out films already booked.
    public var recommendedFilms: [RecommendationList.Resolved] {
        let booked = Set(tickets.bookings.map(\.film.id))
        return recommendations.resolved(against: nowShowing + comingSoon, excluding: booked)
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
