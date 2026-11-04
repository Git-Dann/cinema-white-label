import SwiftUI
import CinemaCore
import CinemaDesign

/// Five destinations. Booking is a focused task presented from film or cinema
/// screens, never a permanent tab. `sidebarAdaptable` lets expanded displays
/// (iPhone Duo inner display, iPad) use a sidebar automatically.
public struct RootView: View {
    @State var app: AppModel
    @State private var tab: AppTab = .home
    @State private var booking: BookingRequest?
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.scenePhase) private var scenePhase

    public init(app: AppModel) { _app = State(initialValue: app) }

    public var body: some View {
        TabView(selection: $tab) {
            Tab("Home", systemImage: "star.fill", value: AppTab.home) {
                NavigationStack { HomeView() }
            }
            Tab("Films", systemImage: "film.stack", value: AppTab.films) {
                NavigationStack { FilmsView() }
            }
            Tab("Cinemas", systemImage: "mappin.and.ellipse", value: AppTab.cinemas) {
                NavigationStack { CinemasView() }
            }
            Tab("Tickets", systemImage: "ticket.fill", value: AppTab.tickets) {
                NavigationStack { TicketsView() }
            }
            .badge(app.tickets.upcoming().count)
            Tab("Account", systemImage: "person.crop.circle", value: AppTab.account) {
                NavigationStack { AccountView() }
            }
        }
        .tabViewStyle(.sidebarAdaptable)
        .tabBarMinimizeBehavior(.onScrollDown)
        .environment(app)
        .environment(\.mediaBaseURL, app.mediaBaseURL)
        .environment(\.startBooking, StartBookingAction { booking = $0 })
        .fullScreenCover(item: $booking) { request in
            BookingFlowView(request: request) { result in
                booking = nil
                if case .confirmed(let b) = result {
                    app.tickets.insert(b)
                    tab = .tickets
                }
            }
            .environment(app)
            .environment(\.mediaBaseURL, app.mediaBaseURL)
            .cinemaTheme(app.configStore.activeTheme(increasedContrast: contrast == .increased))
        }
        .cinemaTheme(app.configStore.activeTheme(increasedContrast: contrast == .increased))
        .task { await app.start() }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await app.refreshConfig() } }
        }
        .onOpenURL { url in handleDeepLink(url) }
    }

    /// cinema://tickets, cinema://film/<id>
    private func handleDeepLink(_ url: URL) {
        switch url.host() {
        case "tickets": tab = .tickets
        case "cinemas": tab = .cinemas
        case "film", "films": tab = .films
        default: break
        }
    }
}

enum AppTab: Hashable { case home, films, cinemas, tickets, account }

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
