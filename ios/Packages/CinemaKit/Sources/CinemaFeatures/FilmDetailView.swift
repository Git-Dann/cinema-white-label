import SwiftUI
import AVKit
import CinemaCore
import CinemaDesign

/// Film detail: landscape backdrop hero tinted by the artwork's dominant
/// colour, centred poster, primary actions, synopsis, facts row, showtimes for
/// the selected cinema and trailers. Matches the design references' hierarchy.
struct FilmDetailView: View {
    let film: Film
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var expanded = false
    @State private var playing: PlayableTrailer?

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: 24) {
                    hero
                    actions(proxy: proxy)
                    synopsis
                    facts
                    ShowtimesSection(film: film).id("showtimes")
                    trailers
                    credits
                }
                .padding(.bottom, 40)
            }
            .background(palette.background)
            .scrollEdgeEffectStyle(.soft, for: .top)
        }
        .navigationTitle(film.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: "\(film.title) at \(app.config.tenant.name)") { Image(systemName: "square.and.arrow.up") }
                    .accessibilityLabel("Share film")
            }
        }
        .task { await app.analytics.record(.filmViewed, ["filmId": film.id]) }
        .fullScreenCover(item: $playing) { t in
            // Playback starts only when the customer asks; never autoplay on entry.
            VideoPlayer(player: AVPlayer(url: t.url)).ignoresSafeArea()
                .overlay(alignment: .topLeading) {
                    Button("Close") { playing = nil }.buttonStyle(.glass).padding()
                }
        }
    }

    private func play(_ trailer: Film.Trailer) {
        guard let raw = trailer.url, let url = URL(string: raw, relativeTo: app.mediaBaseURL)?.absoluteURL else { return }
        playing = PlayableTrailer(id: trailer.id, url: url)
    }

    private var tint: Color { film.backdrop?.dominantColor.map { Color(hex: $0) } ?? palette.surface }

    private var hero: some View {
        ZStack(alignment: .bottom) {
            // Landscape backdrop as the hero; never a stretched portrait poster.
            ArtworkImage(film.backdrop)
                .frame(height: 340)
                .overlay(LinearGradient(colors: [tint.opacity(0.1), tint.opacity(0.65), palette.background], startPoint: .top, endPoint: .bottom))
                .clipped()
            VStack(spacing: 14) {
                ArtworkImage(film.poster, accessibilityLabel: "\(film.title) poster")
                    .aspectRatio(2 / 3, contentMode: .fit)
                    .frame(width: sizeClass == .regular ? 220 : 180)
                    .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
                    .shadow(color: .black.opacity(0.5), radius: 24, y: 14)
                Text(film.title)
                    .font(.largeTitle.weight(.bold))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(palette.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(subtitle).font(.subheadline).foregroundStyle(palette.textMuted).multilineTextAlignment(.center)
            }
            .padding(.horizontal, 24)
            .offset(y: 150)
        }
        .padding(.bottom, 150)
    }

    private var subtitle: String {
        var parts: [String] = [film.certificate]
        if let d = app.formatters.date(fromLocal: film.releaseDate, timeZone: app.config.tenant.timeZone) {
            parts.append(film.status == .comingSoon ? "Out \(app.formatters.longDate(d, timeZone: app.config.tenant.timeZone))" : app.formatters.shortDate(d, timeZone: app.config.tenant.timeZone))
        }
        parts.append(app.formatters.runtime(film.runtimeMinutes))
        return parts.joined(separator: " · ")
    }

    private func actions(proxy: ScrollViewProxy) -> some View {
        HStack(spacing: 14) {
            Button {
                withAnimation { proxy.scrollTo("showtimes", anchor: .top) }
            } label: { Label(film.status == .comingSoon ? "Book Ahead" : "Book Tickets", systemImage: "ticket") }
                .buttonStyle(.cinemaPrimary)
            if let trailer = film.trailers.first {
                Button { play(trailer) } label: { Label("Trailer", systemImage: "play.fill") }
                    .buttonStyle(.cinemaGlass)
                    .disabled(trailer.url == nil)
                    .accessibilityHint(trailer.url == nil ? "Trailer not available in this build" : "")
            }
        }
        .padding(.horizontal, 20)
    }

    private var synopsis: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let tagline = film.tagline { Text(tagline).font(.headline).foregroundStyle(palette.textPrimary) }
            Text(film.synopsis)
                .font(.body)
                .foregroundStyle(palette.textSecondary)
                .lineLimit(expanded ? nil : 3)
            Button(expanded ? "Show less" : "Show more") { withAnimation { expanded.toggle() } }
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(palette.textMuted)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
    }

    private var facts: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 28) {
                StatItem(icon: "clock.fill", label: "Runtime", value: app.formatters.runtime(film.runtimeMinutes), spokenValue: app.formatters.spokenRuntime(film.runtimeMinutes))
                StatItem(icon: "shield.lefthalf.filled", label: "Certificate", value: film.certificate)
                if let g = film.genres.first { StatItem(icon: "theatermasks.fill", label: "Genre", value: g) }
                if !film.formats.isEmpty { StatItem(icon: "film", label: "Formats", value: film.formats.joined(separator: ", ")) }
            }
            .padding(.horizontal, 20)
        }
    }

    @ViewBuilder
    private var trailers: some View {
        if !film.trailers.isEmpty {
            VStack(alignment: .leading, spacing: 12) {
                SectionHeader("Trailers")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 14) {
                        ForEach(film.trailers) { t in
                            Button { play(t) } label: { VStack(alignment: .leading, spacing: 6) {
                                ArtworkImage(film.backdrop)
                                    .frame(width: 260, height: 146)
                                    .overlay { Image(systemName: "play.circle.fill").font(.system(size: 44)).foregroundStyle(.white.opacity(t.url == nil ? 0.4 : 0.95)) }
                                    .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.medium, style: .continuous))
                                Text(t.title).font(.subheadline.weight(.semibold)).foregroundStyle(palette.textPrimary)
                                Text(t.url == nil ? "Licensed trailer source not configured" : "Trailer").font(.caption).foregroundStyle(palette.textMuted)
                            } }
                            .buttonStyle(.plain)
                            .disabled(t.url == nil)
                            .accessibilityElement(children: .combine)
                        }
                    }
                    .padding(.horizontal, 20)
                }
            }
        }
    }

    private var credits: some View {
        VStack(alignment: .leading, spacing: 10) {
            SectionHeader("About")
            VStack(alignment: .leading, spacing: 12) {
                if let d = film.director { fact("Director", d) }
                if !film.cast.isEmpty { fact("Starring", film.cast.joined(separator: ", ")) }
                fact("Genres", film.genres.joined(separator: ", "))
                if !film.attributions.isEmpty { fact("Artwork", film.attributions.joined(separator: "; ")) }
            }
            .padding(.horizontal, 20)
        }
    }

    private func fact(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.subheadline).foregroundStyle(palette.textMuted)
            Text(value).font(.body).foregroundStyle(palette.textPrimary)
        }
        .padding(.leading, 12)
        .overlay(alignment: .leading) { Capsule().fill(palette.divider).frame(width: 3) }
        .accessibilityElement(children: .combine)
    }
}

/// Date strip and times grouped by format, for the selected cinema.
struct ShowtimesSection: View {
    let film: Film
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Environment(\.startBooking) private var startBooking
    @State private var dates: [String] = []
    @State private var selectedDate: String?
    @State private var screenings: [ScreeningSummary] = []
    @State private var loading = false
    @State private var showingVenuePicker = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            SectionHeader("Showtimes", subtitle: app.selectedVenue?.name)
            Button { showingVenuePicker = true } label: {
                Label(app.selectedVenue == nil ? "Choose a cinema" : "Change cinema", systemImage: "mappin.and.ellipse")
                    .font(.subheadline.weight(.semibold))
            }
            .padding(.horizontal, 20)

            if app.selectedVenue != nil {
                if dates.isEmpty && !loading {
                    Text(film.status == .comingSoon ? "Tickets for this film aren't on sale here yet." : "No upcoming showtimes at this cinema.")
                        .font(.subheadline).foregroundStyle(palette.textMuted).padding(.horizontal, 20)
                }
                dateStrip
                timesByFormat
            }
        }
        .sheet(isPresented: $showingVenuePicker) { VenuePickerSheet() }
        .task(id: app.selectedVenueID) { await loadDates() }
        .task(id: selectedDate) { await loadScreenings() }
    }

    private var dateStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                ForEach(dates, id: \.self) { day in
                    let tz = app.selectedVenue?.timeZone ?? "Europe/London"
                    let date = app.formatters.date(fromLocal: day, timeZone: tz)
                    let selected = day == selectedDate
                    Button { selectedDate = day } label: {
                        Text(date.map { app.formatters.shortDate($0, timeZone: tz) } ?? day)
                            .font(.subheadline.weight(.semibold))
                            .padding(.horizontal, 14).frame(minHeight: 44)
                            .foregroundStyle(selected ? palette.selectedText : palette.textPrimary)
                            .background(selected ? palette.selected : palette.surfaceElevated, in: Capsule())
                    }
                    .accessibilityAddTraits(selected ? .isSelected : [])
                    .accessibilityLabel(date.map { app.formatters.longDate($0, timeZone: tz) } ?? day)
                }
            }
            .padding(.horizontal, 20)
        }
    }

    private var timesByFormat: some View {
        let groups = Dictionary(grouping: screenings) { ($0.formats + $0.attributes).joined(separator: " · ") }
        return VStack(alignment: .leading, spacing: 16) {
            if loading { ProgressView().frame(maxWidth: .infinity) }
            ForEach(groups.keys.sorted(), id: \.self) { key in
                VStack(alignment: .leading, spacing: 8) {
                    Text(key).font(.headline).foregroundStyle(palette.textPrimary)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 92), spacing: 10)], spacing: 10) {
                        ForEach(groups[key]!) { s in timeButton(s) }
                    }
                }
            }
        }
        .padding(.horizontal, 20)
    }

    private func timeButton(_ s: ScreeningSummary) -> some View {
        let time = app.formatters.time(s.startsAt, timeZone: s.venue.timeZone)
        return Button { startBooking(s.id) } label: {
            VStack(spacing: 2) {
                Text(time).font(.headline)
                Text(s.availability.level == .soldOut ? "Sold out" : s.availability.level == .limited ? "Few left" : s.auditorium.name)
                    .font(.caption2)
                    .foregroundStyle(s.availability.level == .limited ? palette.warning : palette.textMuted)
            }
            .frame(maxWidth: .infinity, minHeight: 56)
            .foregroundStyle(palette.textPrimary)
            .background(palette.surface, in: RoundedRectangle(cornerRadius: palette.cornerRadius.small, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: palette.cornerRadius.small, style: .continuous).strokeBorder(palette.divider))
        }
        .disabled(!s.onSale)
        .accessibilityLabel("\(time), \(s.auditorium.name), \(s.formats.joined(separator: " ")), \(s.availability.level == .soldOut ? "sold out" : "\(s.availability.available) seats available")")
    }

    private func loadDates() async {
        guard let venue = app.selectedVenue else { return }
        loading = true
        dates = (try? await app.service.screeningDates(venueId: venue.id, filmId: film.id)) ?? []
        if selectedDate == nil || !dates.contains(selectedDate!) { selectedDate = dates.first }
        if dates.isEmpty { screenings = []; loading = false }
    }

    private func loadScreenings() async {
        guard let venue = app.selectedVenue, let date = selectedDate else { return }
        loading = true
        defer { loading = false }
        screenings = (try? await app.service.screenings(venueId: venue.id, filmId: film.id, date: date)) ?? []
    }
}

struct PlayableTrailer: Identifiable { let id: String; let url: URL }
