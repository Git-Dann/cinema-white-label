import SwiftUI
import CinemaCore
import CinemaDesign

// End-to-end previews backed by MockCinemaService: real holds, quotes, food,
// vouchers and bookings against fixture data, with no backend.

@MainActor
private func previewApp(slug: String = "northlight") -> AppModel {
    let service = MockCinemaService(config: PreviewFixtures.config(slug))
    let dir = FileManager.default.temporaryDirectory.appendingPathComponent("previews-\(slug)")
    return AppModel(
        service: service,
        configStore: TenantConfigStore(bundled: PreviewFixtures.config(slug), cacheDirectory: dir),
        tickets: TicketStore(cacheDirectory: dir, tenantSlug: slug),
        mediaBaseURL: URL(string: "http://localhost:3000/")!
    )
}

private struct BookingFlowPreview: View {
    let screeningId: String
    var slug = "northlight"
    @State private var app: AppModel?
    var body: some View {
        Group {
            if let app {
                BookingFlowView(request: BookingRequest(screeningId: screeningId)) { _ in }
                    .environment(app)
                    .cinemaTheme(app.config.theme, typography: app.config.typography)
            } else {
                ProgressView()
            }
        }
        .task { app = previewApp(slug: slug) }
    }
}

#Preview("Booking · standard") { BookingFlowPreview(screeningId: "preview-standard") }
#Preview("Booking · premiere pods & beds") { BookingFlowPreview(screeningId: "preview-premiere") }
#Preview("Booking · Kestrel classic") { BookingFlowPreview(screeningId: "preview-luxe", slug: "kestrel") }

#Preview("Food & drink options") {
    ProductOptionsSheet(product: PreviewFixtures.menu.categories[2].items[0], formatters: Formatters()) { _ in }
        .cinemaTheme(PreviewFixtures.config().theme)
}

#Preview("Loading and errors") {
    VStack(spacing: 16) {
        LoadingView("Loading seats…")
        InfoBanner(.error, "You appear to be offline. Check your connection and try again.", actionTitle: "Retry") {}
        InfoBanner(.warning, "Your selection leaves a single empty seat (C2). Try moving along one seat.")
        ContentUnavailableView("Sold out", systemImage: "ticket", description: Text("There are no seats left for this showing."))
    }
    .padding()
    .cinemaTheme(PreviewFixtures.config().theme)
}
