import SwiftUI
import AVKit
import CinemaCore
import CinemaDesign

/// Film detail: full-height backdrop behind the poster and title that fades into
/// the page (no hard edge), primary actions, synopsis, facts, showtimes for the
/// selected cinema, trailers and credits. All spacing comes from `Spacing`.
struct FilmDetailView: View {
    let film: Film
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var expanded = false
    @State private var playing: PlayableTrailer?
    /// Flipped once the big title scrolls away; shows the bar title and the soft
    /// edge under the bar. A Bool, so scrolling does not re-evaluate the page every frame.
    @State private var scrolledPastTitle = false

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(spacing: Spacing.section) {
                    VStack(spacing: Spacing.xl) {
                        hero
                        actions(proxy: proxy)
                    }
                    synopsis
                    facts
                    ShowtimesSection(film: film).id("showtimes")
                    trailers
                    credits
                }
                .padding(.bottom, Spacing.section)
            }
            .onScrollGeometryChange(for: Bool.self) { geo in
                geo.contentOffset.y + geo.contentInsets.top > Self.titleScrollThreshold
            } action: { _, past in
                withAnimation(.easeOut(duration: 0.2)) { scrolledPastTitle = past }
            }
            // The whole page takes the film's colour, fading into the theme background.
            .background { pageBackground }
            // Clean artwork at the top; once scrolled, content softens under the bar instead of clashing with it.
            .scrollEdgeEffectHidden(!scrolledPastTitle, for: .top)
        }
        .navigationTitle(film.title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackgroundVisibility(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .principal) {
                // The bar title appears only after the big title has scrolled away.
                Text(film.title).font(.headline).lineLimit(1)
                    .foregroundStyle(palette.textPrimary)
                    .opacity(scrolledPastTitle ? 1 : 0)
                    .accessibilityHidden(!scrolledPastTitle)
            }
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: "\(film.title) at \(app.config.tenant.name)") { Image(systemName: "square.and.arrow.up") }
                    .accessibilityLabel("Share film")
            }
        }
        .task {
            await app.analytics.record(.filmViewed, ["filmId": film.id])
        }
        .onAppear {
            // Warm the hero, poster and trailer stills before they scroll into view.
            let urls = [film.backdrop?.url(forPixelWidth: 1280, base: app.mediaBaseURL), film.poster?.url(forPixelWidth: 780, base: app.mediaBaseURL)].compactMap { $0 }
            Task { await ImagePipeline.shared.prefetch(urls) }
        }
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

    /// How far the backdrop extends above the hero, enough to reach the top of any device.
    private static let heroBleed: CGFloat = 240

    /// Content colour from the artwork (computed on the server, so nothing is analysed on the phone).
    private var tint: Color {
        (film.backdrop?.dominantColor ?? film.poster?.dominantColor).map { Color(hex: $0) } ?? palette.surface
    }

    /// Roughly where the big title leaves the screen.
    private static let titleScrollThreshold: CGFloat = 360

    private var pageBackground: some View {
        ZStack {
            palette.background
            LinearGradient(stops: [.init(color: tint.mix(with: palette.background, by: 0.45), location: 0),
                                   .init(color: tint.mix(with: palette.background, by: 0.75), location: 0.35),
                                   .init(color: palette.background, location: 0.75)],
                           startPoint: .top, endPoint: .bottom)
        }
        .ignoresSafeArea()
    }

    /// The backdrop fills the whole hero, from under the navigation bar to below the
    /// title, and fades into the page background, so there is never a cut-off edge.
    private var hero: some View {
        VStack(spacing: Spacing.m) {
            ArtworkImage(film.poster, accessibilityLabel: "\(film.title) poster")
                .aspectRatio(2 / 3, contentMode: .fit)
                .frame(width: sizeClass == .regular ? 240 : 210)
                .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
                .tiltEffect(cornerRadius: palette.cornerRadius.large)
            VStack(spacing: Spacing.xs) {
                Text(film.title)
                    .font(.largeTitle.weight(.bold))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(palette.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                Text(subtitle).font(.subheadline).foregroundStyle(palette.textSecondary).multilineTextAlignment(.center)
            }
        }
        .padding(.top, Spacing.xl)
        .pagePadding()
        .frame(maxWidth: .infinity)
        .background(alignment: .top) {
            ArtworkImage(film.backdrop)
                // Light shade at the very top keeps the back and share buttons readable.
                .overlay(LinearGradient(colors: [palette.background.opacity(0.4), .clear], startPoint: .top, endPoint: .center))
                // Fade the artwork out into the film-coloured page rather than to a flat colour.
                .mask(LinearGradient(stops: [.init(color: .black, location: 0), .init(color: .black, location: 0.45), .init(color: .clear, location: 1)],
                                     startPoint: .top, endPoint: .bottom))
                .clipped()
                // Parallax: the artwork scrolls at a little over half speed. Runs on the GPU, no re-layout.
                .visualEffect { content, proxy in
                    content.offset(y: -proxy.frame(in: .scrollView).minY * 0.45)
                }
                // Extend the image upwards past the hero's own frame: behind the navigation bar
                // and status bar to the top of the screen. Anything above the screen is never seen.
                .padding(.top, -Self.heroBleed)
                .accessibilityHidden(true)
        }
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
        HStack(spacing: Spacing.s) {
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
        .pagePadding()
    }

    private var synopsis: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
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
        .pagePadding()
    }

    /// Facts as one swipeable row, label over value, no box around them.
    private var facts: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(alignment: .top, spacing: Spacing.xl) {
                StatItem(icon: "clock.fill", label: "Runtime", value: app.formatters.runtime(film.runtimeMinutes), spokenValue: app.formatters.spokenRuntime(film.runtimeMinutes)).fixedSize()
                if let g = film.genres.first { StatItem(icon: "theatermasks.fill", label: "Genre", value: g).fixedSize() }
                StatItem(icon: "shield.lefthalf.filled", label: "Certificate", value: film.certificate).fixedSize()
                ForEach(film.formats, id: \.self) { f in StatItem(icon: "film", label: "Format", value: f).fixedSize() }
            }
            .pagePadding()
        }
        .scrollClipDisabled()
    }

    @ViewBuilder
    private var trailers: some View {
        if !film.trailers.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.header) {
                SectionHeader("Trailers")
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: Spacing.item) {
                        ForEach(film.trailers) { t in
                            Button { play(t) } label: {
                                VStack(alignment: .leading, spacing: Spacing.xs) {
                                    ArtworkImage(film.backdrop)
                                        .frame(width: 280, height: 158)
                                        .overlay {
                                            // A solid disc reads clearly over any artwork.
                                            Image(systemName: "play.fill")
                                                .font(.title2)
                                                .foregroundStyle(.white)
                                                .frame(width: 56, height: 56)
                                                .background(.black.opacity(0.55), in: Circle())
                                                .opacity(t.url == nil ? 0.5 : 1)
                                        }
                                        .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
                                    VStack(alignment: .leading, spacing: Spacing.xxs) {
                                        Text(t.title).font(.subheadline.weight(.semibold)).foregroundStyle(palette.textPrimary)
                                        Text(t.url == nil ? "Licensed trailer source not configured" : "Trailer").font(.caption).foregroundStyle(palette.textMuted)
                                    }
                                }
                                .frame(width: 280, alignment: .leading)
                            }
                            .buttonStyle(.plain)
                            .disabled(t.url == nil)
                            .accessibilityElement(children: .combine)
                        }
                    }
                    .pagePadding()
                }
            }
        }
    }

    private var credits: some View {
        var rows: [(label: String, value: String)] = []
        if let d = film.director { rows.append(("Director", d)) }
        if !film.cast.isEmpty { rows.append(("Starring", film.cast.joined(separator: ", "))) }
        if !film.genres.isEmpty { rows.append(("Genres", film.genres.joined(separator: ", "))) }
        if !film.attributions.isEmpty { rows.append(("Artwork", film.attributions.joined(separator: "; "))) }
        return VStack(alignment: .leading, spacing: Spacing.header) {
            SectionHeader("About")
            DetailRows(rows).pagePadding()
        }
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
        VStack(alignment: .leading, spacing: Spacing.header) {
            SectionHeader("Showtimes", subtitle: app.selectedVenue?.name)
            Button { showingVenuePicker = true } label: {
                Label(app.selectedVenue == nil ? "Choose a cinema" : "Change cinema", systemImage: "mappin.and.ellipse")
                    .font(.subheadline.weight(.semibold))
                    .frame(minHeight: Spacing.tap)
            }
            .pagePadding()

            if app.selectedVenue != nil {
                if dates.isEmpty && !loading {
                    Text(film.status == .comingSoon ? "Tickets for this film aren't on sale here yet." : "No upcoming showtimes at this cinema.")
                        .font(.subheadline).foregroundStyle(palette.textMuted).pagePadding()
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
            HStack(spacing: Spacing.xs) {
                ForEach(dates, id: \.self) { day in
                    let tz = app.selectedVenue?.timeZone ?? "Europe/London"
                    let date = app.formatters.date(fromLocal: day, timeZone: tz)
                    Chip(date.map { app.formatters.shortDate($0, timeZone: tz) } ?? day, selected: day == selectedDate) { selectedDate = day }
                        .accessibilityLabel(date.map { app.formatters.longDate($0, timeZone: tz) } ?? day)
                }
            }
            .pagePadding()
        }
    }

    private var timesByFormat: some View {
        let groups = Dictionary(grouping: screenings) { ($0.formats + $0.attributes).joined(separator: " · ") }
        return VStack(alignment: .leading, spacing: Spacing.l) {
            if loading { ProgressView().frame(maxWidth: .infinity) }
            ForEach(groups.keys.sorted(), id: \.self) { key in
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    Text(key).font(.headline).foregroundStyle(palette.textPrimary)
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 104), spacing: Spacing.xs)], spacing: Spacing.xs) {
                        ForEach(groups[key]!.sorted { $0.startsAt < $1.startsAt }) { s in timeButton(s) }
                    }
                }
            }
        }
        .pagePadding()
    }

    /// Every tile is the same size: time on top, one line of detail underneath.
    private func timeButton(_ s: ScreeningSummary) -> some View {
        let time = app.formatters.time(s.startsAt, timeZone: s.venue.timeZone)
        let detail = s.availability.level == .soldOut ? "Sold out" : s.availability.level == .limited ? "Few left" : s.auditorium.name
        return Button { startBooking(s.id) } label: {
            VStack(spacing: Spacing.xxs) {
                Text(time).font(.headline.monospacedDigit())
                Text(detail)
                    .font(.caption)
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                    .foregroundStyle(s.availability.level == .limited ? palette.warning : palette.textMuted)
            }
            .padding(.horizontal, Spacing.xs)
            .frame(maxWidth: .infinity, minHeight: 64, maxHeight: 64)
            .foregroundStyle(palette.textPrimary)
            .background(palette.surface, in: RoundedRectangle(cornerRadius: palette.cornerRadius.medium, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: palette.cornerRadius.medium, style: .continuous).strokeBorder(palette.border.opacity(0.5)))
            .opacity(s.onSale ? 1 : 0.5)
        }
        .buttonStyle(.plain)
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
