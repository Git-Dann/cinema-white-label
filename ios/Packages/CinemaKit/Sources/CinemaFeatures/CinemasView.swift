import SwiftUI
import MapKit
import CoreLocation
import CinemaCore
import CinemaDesign

/// One-shot location lookup for the Cinemas tab. Permission is asked once, in
/// context, the first time the tab opens; after that the nearest cinemas load on
/// their own. The coordinate is never sent to analytics.
@MainActor
@Observable
final class LocationProvider: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private var continuation: CheckedContinuation<CLLocation?, Never>?
    private(set) var denied = false
    /// True once the customer has allowed location, so the tab can locate without a tap.
    var isAuthorised: Bool { [.authorizedWhenInUse, .authorizedAlways].contains(manager.authorizationStatus) }
    var notAskedYet: Bool { manager.authorizationStatus == .notDetermined }

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyKilometer
    }

    func currentLocation() async -> CLLocation? {
        if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted { denied = true; return nil }
        return await withCheckedContinuation { c in
            continuation = c
            if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() } else { manager.requestLocation() }
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        Task { @MainActor in
            switch manager.authorizationStatus {
            case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
            case .denied, .restricted: denied = true; finish(nil)
            default: break
            }
        }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in finish(locations.last) }
    }
    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: any Error) {
        Task { @MainActor in finish(nil) }
    }
    private func finish(_ l: CLLocation?) { continuation?.resume(returning: l); continuation = nil }
}

/// Cinemas: map, nearby list, search by name/town/postcode, favourites.
struct CinemasView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @State private var location = LocationProvider()
    @State private var query = ""
    @State private var nearby: [Venue]?
    @State private var searchResults: [Venue]?
    @State private var locating = false
    @State private var camera: MapCameraPosition = .automatic
    @AppStorage("cinemas.askedForLocation") private var askedForLocation = false

    var body: some View {
        let list = searchResults ?? nearby ?? app.venues
        List {
            Section {
                Map(position: $camera) {
                    ForEach(list) { v in
                        Marker(v.shortName(operatorWordmark: app.config.branding.wordmark), systemImage: "film", coordinate: CLLocationCoordinate2D(latitude: v.coordinate.latitude, longitude: v.coordinate.longitude))
                            .tint(palette.actionPrimary)
                    }
                    UserAnnotation()
                }
                .frame(height: 220)
                .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.medium, style: .continuous))
                .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0))
                .accessibilityLabel("Map of cinemas")

                if nearby == nil || location.denied {
                    Button {
                        Task { await locate() }
                    } label: {
                        Label(locating ? "Finding cinemas near you…" : "Show cinemas near me", systemImage: "location.fill")
                    }
                    .disabled(locating)
                }
                if location.denied {
                    Text("Location access is off. You can still search by town or postcode, or turn it on in Settings.")
                        .font(.footnote).foregroundStyle(palette.textMuted)
                }
            }
            if !app.favouriteVenues.isEmpty && searchResults == nil {
                Section("Your cinemas") { ForEach(app.favouriteVenues) { row($0) } }
            }
            Section(searchResults != nil ? "Results" : nearby != nil ? "Nearest" : "All cinemas") {
                if list.isEmpty { Text("No cinemas match \"\(query)\".").foregroundStyle(palette.textMuted) }
                ForEach(list) { row($0) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(palette.background)
        .navigationTitle("Cinemas")
        .searchable(text: $query, prompt: "Town, postcode or cinema")
        .task(id: query) {
            let q = query.trimmingCharacters(in: .whitespaces)
            guard !q.isEmpty else { searchResults = nil; return }
            try? await Task.sleep(for: .milliseconds(300))
            searchResults = try? await app.reloadVenues(query: q)
        }
        .navigationDestination(for: Venue.self) { CinemaDetailView(venue: $0) }
        .task {
            // Already allowed: show nearest straight away. Never asked: ask once, here, where it makes sense.
            guard nearby == nil else { return }
            if location.isAuthorised || (location.notAskedYet && !askedForLocation) {
                askedForLocation = true
                await locate()
            }
        }
    }

    private func row(_ v: Venue) -> some View {
        NavigationLink(value: v) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(v.name).font(.headline).foregroundStyle(palette.textPrimary)
                        if v.id == app.selectedVenueID { Image(systemName: "checkmark.circle.fill").foregroundStyle(palette.actionPrimary).accessibilityLabel("Your cinema") }
                    }
                    Text([v.address.city, v.distanceKm.map(Self.distance)].compactMap { $0 }.joined(separator: " · "))
                        .font(.subheadline).foregroundStyle(palette.textMuted)
                }
                Spacer()
                Button { Task { await app.toggleFavourite(v) } } label: {
                    Image(systemName: isFavourite(v) ? "house.fill" : "house").foregroundStyle(isFavourite(v) ? palette.actionPrimary : palette.textMuted)
                        .frame(width: 44, height: 44)
                        .contentTransition(.symbolEffect(.replace))
                }
                .buttonStyle(.borderless)
                .sensoryFeedback(.selection, trigger: isFavourite(v))
                .accessibilityLabel(isFavourite(v) ? "Remove from your cinemas" : "Add to your cinemas")
            }
        }
    }

    /// Road distance in the customer's units (miles in the UK).
    static func distance(_ km: Double) -> String {
        Measurement(value: km, unit: UnitLength.kilometers).formatted(.measurement(width: .abbreviated, usage: .road, numberFormatStyle: .number.precision(.fractionLength(0...1))))
    }

    private func isFavourite(_ v: Venue) -> Bool { app.venues.first { $0.id == v.id }?.isFavourite ?? v.isFavourite }

    private func locate() async {
        locating = true
        defer { locating = false }
        guard let loc = await location.currentLocation() else { return }
        nearby = try? await app.reloadVenues(near: loc.coordinate.latitude, longitude: loc.coordinate.longitude)
        if let first = nearby?.first {
            camera = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: first.coordinate.latitude, longitude: first.coordinate.longitude), latitudinalMeters: 60_000, longitudinalMeters: 60_000))
        }
    }
}

struct CinemaDetailView: View {
    let venue: Venue
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Environment(\.startBooking) private var startBooking
    @State private var screenings: [ScreeningSummary] = []

    var body: some View {
        List {
            Section {
                Map(initialPosition: .region(MKCoordinateRegion(center: coordinate, latitudinalMeters: 1500, longitudinalMeters: 1500))) {
                    Marker(venue.name, systemImage: "film", coordinate: coordinate).tint(palette.actionPrimary)
                }
                .frame(height: 180)
                .listRowInsets(EdgeInsets())
                Text("\(venue.address.line1), \(venue.address.city) \(venue.address.postcode)")
                Button { openDirections() } label: { Label("Directions in Maps", systemImage: "arrow.triangle.turn.up.right.diamond.fill") }
                Button { app.selectedVenueID = venue.id } label: {
                    Label(app.selectedVenueID == venue.id ? "This is your cinema" : "Make this my cinema", systemImage: "checkmark.circle")
                }
                .disabled(app.selectedVenueID == venue.id)
            }
            if !venue.facilities.isEmpty {
                Section("Facilities") { ForEach(venue.facilities, id: \.self) { Text($0) } }
            }
            Section("Next showings") {
                if screenings.isEmpty { Text("Loading…").foregroundStyle(palette.textMuted) }
                ForEach(screenings.prefix(12)) { s in
                    Button { startBooking(s.id) } label: {
                        HStack {
                            VStack(alignment: .leading) {
                                Text(s.film.title).font(.headline).foregroundStyle(palette.textPrimary)
                                Text("\(app.formatters.shortDate(s.startsAt, timeZone: venue.timeZone)) · \(s.auditorium.name) · \(s.formats.joined(separator: " "))")
                                    .font(.subheadline).foregroundStyle(palette.textMuted)
                            }
                            Spacer()
                            Text(app.formatters.time(s.startsAt, timeZone: venue.timeZone)).font(.headline.monospacedDigit()).foregroundStyle(palette.textPrimary)
                        }
                    }
                    .disabled(!s.onSale)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(palette.background)
        .navigationTitle(venue.shortName(operatorWordmark: app.config.branding.wordmark))
        .task { screenings = (try? await app.service.screenings(venueId: venue.id, filmId: nil, date: nil)) ?? [] }
    }

    private var coordinate: CLLocationCoordinate2D { CLLocationCoordinate2D(latitude: venue.coordinate.latitude, longitude: venue.coordinate.longitude) }

    /// Hands off to Apple Maps, which gives the clearest directions experience.
    private func openDirections() {
        let item = MKMapItem(location: CLLocation(latitude: venue.coordinate.latitude, longitude: venue.coordinate.longitude), address: nil)
        item.name = venue.name
        item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeDefault])
    }
}

/// Sheet for choosing the customer's cinema.
struct VenuePickerSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette

    var body: some View {
        NavigationStack {
            List(app.venues) { v in
                Button {
                    app.selectedVenueID = v.id
                    dismiss()
                } label: {
                    HStack {
                        VStack(alignment: .leading) {
                            Text(v.name).foregroundStyle(palette.textPrimary)
                            Text(v.address.city).font(.subheadline).foregroundStyle(palette.textMuted)
                        }
                        Spacer()
                        if v.isFavourite { Image(systemName: "house.fill").foregroundStyle(palette.actionPrimary).accessibilityLabel("One of your cinemas") }
                        if v.id == app.selectedVenueID { Image(systemName: "checkmark").foregroundStyle(palette.actionPrimary).accessibilityLabel("Selected") }
                    }
                }
            }
            .navigationTitle("Choose a cinema")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(role: .close) { dismiss() } } }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }
}
