import SwiftUI
import CoreSpotlight
import CinemaCore
import CinemaDesign

/// Five destinations: Home, Films, Cinemas, Food and Tickets. Account opens as a
/// sheet from the avatar at the top right of each. Booking is a focused task
/// presented from film or cinema screens, never a permanent tab. `sidebarAdaptable` lets expanded displays
/// (iPhone Duo inner display, iPad) use a sidebar automatically.
public struct RootView: View {
    @State var app: AppModel
    @State private var tab: AppTab = .home
    @State private var booking: BookingRequest?
    @State private var showingProfile = false
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.scenePhase) private var scenePhase

    public init(app: AppModel) { _app = State(initialValue: app) }

    public var body: some View {
        TabView(selection: $tab) {
            Tab("Home", systemImage: "house.fill", value: AppTab.home) {
                NavigationStack { HomeView().profileToolbar() }
            }
            Tab("Films", systemImage: "film.stack", value: AppTab.films) {
                NavigationStack { FilmsView().profileToolbar() }
            }
            Tab("Cinemas", systemImage: "mappin.and.ellipse", value: AppTab.cinemas) {
                NavigationStack { CinemasView().profileToolbar() }
            }
            // Food takes the place Account had; Account opens from the avatar on every tab.
            if app.config.features.concessions {
                Tab("Food", systemImage: "popcorn.fill", value: AppTab.food) {
                    NavigationStack { FoodView().profileToolbar() }
                }
            }
            Tab("Tickets", systemImage: "ticket.fill", value: AppTab.tickets) {
                NavigationStack { TicketsView().profileToolbar() }
            }
            .badge(app.tickets.upcoming().count)
        }
        .tabViewStyle(.sidebarAdaptable)
        // The tab bar shrinks while scrolling down and returns on scroll up.
        .tabBarMinimizeBehavior(.onScrollDown)
        .environment(app)
        .environment(\.mediaBaseURL, app.mediaBaseURL)
        .environment(\.startBooking, StartBookingAction { booking = $0 })
        .environment(\.showProfile, ShowProfileAction { showingProfile = true })
        .sheet(isPresented: $showingProfile) {
            NavigationStack {
                AccountView()
                    .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(role: .close) { showingProfile = false }.tint(.primary) } }
            }
            .environment(app)
            .environment(\.mediaBaseURL, app.mediaBaseURL)
            .cinemaTheme(app.configStore.activeTheme(increasedContrast: contrast == .increased), typography: app.config.typography)
        }
        .fullScreenCover(item: $booking) { request in
            BookingFlowView(request: request) { result in
                booking = nil
                if case .confirmed(let b) = result {
                    app.tickets.insert(b)
                    app.bookingConfirmed(b)
                    tab = .tickets
                }
            }
            .environment(app)
            .environment(\.mediaBaseURL, app.mediaBaseURL)
            .cinemaTheme(app.configStore.activeTheme(increasedContrast: contrast == .increased), typography: app.config.typography)
        }
        .cinemaTheme(app.configStore.activeTheme(increasedContrast: contrast == .increased), typography: app.config.typography)
        .task { await app.start() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await app.refreshConfig() } }
        }
        .onOpenURL { url in handleDeepLink(url) }
        .onContinueUserActivity(CSSearchableItemActionType) { SpotlightIndexer.handle($0) }
        .onChange(of: AppNavigator.shared.requested) { _, destination in
            guard let destination else { return }
            switch destination {
            case .home: tab = .home
            case .films: tab = .films
            case .cinemas: tab = .cinemas
            case .food: tab = app.config.features.concessions ? .food : .home
            case .tickets: tab = .tickets
            case .account: showingProfile = true
            }
            AppNavigator.shared.requested = nil
        }
        .onChange(of: app.tickets.bookings) { _, _ in
            SpotlightIndexer.index(upcoming: app.tickets.upcoming(), favourites: app.favouriteVenues, formatters: app.formatters)
            app.syncSystemSurfaces()
        }
    }

    /// cinema://tickets, cinema://film/<id>
    private func handleDeepLink(_ url: URL) {
        switch url.host() {
        case "tickets": tab = .tickets
        case "cinemas": tab = .cinemas
        case "film", "films": tab = .films
        case "food": if app.config.features.concessions { tab = .food }
        case "account": showingProfile = true
        default: break
        }
    }
}

enum AppTab: Hashable { case home, films, cinemas, food, tickets }

/// Identifies a screening the customer wants to book.
public struct BookingRequest: Identifiable, Hashable, Sendable {
    public let screeningId: String
    public var id: String { screeningId }
}

public struct StartBookingAction {
    let handler: (BookingRequest) -> Void
    public func callAsFunction(_ screeningId: String) { handler(BookingRequest(screeningId: screeningId)) }
}

private struct StartBookingKey: EnvironmentKey { static let defaultValue = StartBookingAction { _ in } }
extension EnvironmentValues {
    var startBooking: StartBookingAction {
        get { self[StartBookingKey.self] }
        set { self[StartBookingKey.self] = newValue }
    }
}
