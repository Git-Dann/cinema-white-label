import SwiftUI
import CinemaCore
import CinemaDesign

/// Home: selected cinema, featured films, upcoming tickets, now showing and
/// coming soon. Section order and titles come from the tenant config.
struct HomeView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @State private var showingVenuePicker = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 32) {
                cinemaChip
                if let error = app.loadError {
                    InfoBanner(.error, error, actionTitle: "Retry") { Task { await app.loadContent() } }.padding(.horizontal, 20)
                }
                if app.isLoading && app.nowShowing.isEmpty { LoadingView("Loading films…") }
                ForEach(app.config.home) { section in
                    sectionView(section)
                }
            }
            .padding(.bottom, 32)
        }
        .background(palette.background)
        .navigationTitle(app.config.branding.wordmark)
        .toolbarTitleDisplayMode(.inlineLarge)
        .refreshable { await app.loadContent(); await app.tickets.refresh(using: app.service) }
        .sheet(isPresented: $showingVenuePicker) { VenuePickerSheet() }
        .navigationDestination(for: Film.self) { FilmDetailView(film: $0) }
    }

    private var cinemaChip: some View {
        Button { showingVenuePicker = true } label: {
            HStack(spacing: 6) {
                Image(systemName: "mappin.circle.fill").foregroundStyle(palette.actionPrimary)
                Text(app.selectedVenue?.shortName(operatorWordmark: app.config.branding.wordmark) ?? "Choose a cinema")
                    .font(.subheadline.weight(.semibold))
                Image(systemName: "chevron.down").font(.caption.weight(.bold))
            }
            .foregroundStyle(palette.textPrimary)
            .padding(.horizontal, 14).frame(minHeight: 44)
            .glassEffect(.regular.interactive(), in: Capsule())
        }
        .padding(.horizontal, 20)
        .accessibilityLabel("Cinema: \(app.selectedVenue?.name ?? "none selected")")
        .accessibilityHint("Changes your cinema")
    }

    @ViewBuilder
    private func sectionView(_ section: TenantConfig.HomeSection) -> some View {
        switch section.kind {
        case .featured where !app.nowShowing.isEmpty:
            VStack(alignment: .leading, spacing: 14) {
                SectionHeader(section.title, subtitle: section.subtitle) { FilmGridView(title: section.title, films: app.nowShowing) }
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 16) {
                        ForEach(app.nowShowing.prefix(6)) { film in
                            NavigationLink(value: film) { FeaturedFilmCard(film: film, width: 260) }.buttonStyle(.plain)
                        }
                    }
                    .scrollTargetLayout()
                    .padding(.horizontal, 20)
                }
                .scrollTargetBehavior(.viewAligned)
            }
        case .upcomingBookings:
            let upcoming = app.tickets.upcoming()
            if !upcoming.isEmpty {
                VStack(alignment: .leading, spacing: 14) {
                    SectionHeader(section.title, subtitle: upcoming.count == 1 ? "1 upcoming screening" : "\(upcoming.count) upcoming screenings")
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(spacing: 16) {
                            ForEach(upcoming) { b in
                                NavigationLink { TicketDetailView(booking: b) } label: { UpcomingTicketCard(booking: b) }.buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 20)
                    }
                }
            }
        case .nowShowing where !app.nowShowing.isEmpty:
            posterRow(section, films: app.nowShowing, caption: { $0.formats.contains("IMAX") ? "Also in IMAX" : $0.genres.first })
        case .comingSoon where !app.comingSoon.isEmpty:
            posterRow(section, films: app.comingSoon, caption: { releaseCaption($0) })
        default:
            EmptyView()
        }
    }

    private func posterRow(_ section: TenantConfig.HomeSection, films: [Film], caption: @escaping (Film) -> String?) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader(section.title, subtitle: section.subtitle) { FilmGridView(title: section.title, films: films) }
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: 14) {
                    ForEach(films) { film in
                        NavigationLink(value: film) { PosterCard(film: film, size: .medium, caption: caption(film)) }.buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 20)
            }
        }
    }

    private func releaseCaption(_ film: Film) -> String {
        guard let d = app.formatters.date(fromLocal: film.releaseDate, timeZone: app.config.tenant.timeZone) else { return film.releaseDate }
        return "From " + app.formatters.shortDate(d, timeZone: app.config.tenant.timeZone)
    }
}

/// Landscape card for an upcoming booking (backdrop + time + seats).
struct UpcomingTicketCard: View {
    let booking: Booking
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ArtworkImage(booking.film.backdrop ?? booking.film.poster)
                .frame(width: 300, height: 170)
                .overlay(alignment: .bottomLeading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(booking.film.title).font(.headline)
                        Text("\(app.formatters.shortDate(booking.screening.startsAt, timeZone: booking.venue.timeZone)) · \(app.formatters.time(booking.screening.startsAt, timeZone: booking.venue.timeZone))")
                            .font(.subheadline)
                    }
                    .foregroundStyle(.white)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom))
                }
                .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
            Text("\(booking.auditorium.name) · Seats \(booking.seatSummary)").font(.subheadline).foregroundStyle(palette.textMuted)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Grid of posters, used for "see all" destinations.
struct FilmGridView: View {
    let title: String
    let films: [Film]
    @Environment(\.palette) private var palette

    var body: some View {
        ScrollView {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 104, maximum: 180), spacing: 12)], spacing: 16) {
                ForEach(films) { film in
                    NavigationLink(value: film) {
                        ArtworkImage(film.poster, accessibilityLabel: film.title)
                            .aspectRatio(2 / 3, contentMode: .fit)
                            .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.medium, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .background(palette.background)
        .navigationTitle(title)
        .navigationDestination(for: Film.self) { FilmDetailView(film: $0) }
    }
}
