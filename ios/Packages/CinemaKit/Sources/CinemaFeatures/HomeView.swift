import SwiftUI
import UIKit
import CinemaCore
import CinemaDesign

/// Home: selected cinema, featured films, upcoming tickets, now showing and
/// coming soon. Section order and titles come from the tenant config.
struct HomeView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @State private var showingVenuePicker = false
    @State private var voucherToShow: VoucherCode?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.section) {
                cinemaChip
                if let error = app.loadError {
                    InfoBanner(.error, error, actionTitle: "Retry") { Task { await app.loadContent() } }.pagePadding()
                }
                if app.isLoading && app.nowShowing.isEmpty { LoadingView("Loading films…") }
                ForEach(app.config.home) { section in
                    sectionView(section)
                }
            }
            .padding(.top, Spacing.xs)
            .padding(.bottom, Spacing.section)
        }
        .background(palette.background)
        .navigationTitle(app.config.branding.wordmark)
        .toolbarTitleDisplayMode(.inlineLarge)
        .refreshable { await app.loadContent(); await app.tickets.refresh(using: app.service) }
        .sheet(isPresented: $showingVenuePicker) { VenuePickerSheet() }
        .sheet(item: $voucherToShow) { VoucherCodeSheet(voucher: $0) }
        .navigationDestination(for: Film.self) { FilmDetailView(film: $0) }
    }

    private var cinemaChip: some View {
        Button { showingVenuePicker = true } label: {
            HStack(spacing: Spacing.xs) {
                Image(systemName: "mappin.circle.fill").foregroundStyle(palette.actionPrimary)
                Text(app.selectedVenue?.shortName(operatorWordmark: app.config.branding.wordmark) ?? "Choose a cinema")
                    .font(.subheadline.weight(.semibold))
                Image(systemName: "chevron.down").font(.caption.weight(.bold))
            }
            .foregroundStyle(palette.textPrimary)
            .padding(.horizontal, Spacing.m).frame(minHeight: Spacing.tap)
            .glassEffect(.regular.interactive(), in: Capsule())
        }
        .pagePadding()
        .accessibilityLabel("Cinema: \(app.selectedVenue?.name ?? "none selected")")
        .accessibilityHint("Changes your cinema")
    }

    @ViewBuilder
    private func sectionView(_ section: TenantConfig.HomeSection) -> some View {
        switch section.kind {
        case .featured where !app.nowShowing.isEmpty:
            VStack(alignment: .leading, spacing: Spacing.header) {
                SectionHeader(section.title, subtitle: section.subtitle) { FilmGridView(title: section.title, films: app.nowShowing) }
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: Spacing.item) {
                        ForEach(app.nowShowing.prefix(6)) { film in
                            NavigationLink(value: film) { FeaturedFilmCard(film: film, width: 260) }.buttonStyle(.plain)
                        }
                    }
                    .scrollTargetLayout()
                    .pagePadding()
                }
                .scrollTargetBehavior(.viewAligned)
            }
        case .upcomingBookings:
            let upcoming = app.tickets.upcoming()
            if !upcoming.isEmpty {
                VStack(alignment: .leading, spacing: Spacing.header) {
                    SectionHeader(section.title, subtitle: upcoming.count == 1 ? "1 upcoming screening" : "\(upcoming.count) upcoming screenings")
                    ScrollView(.horizontal, showsIndicators: false) {
                        LazyHStack(alignment: .top, spacing: Spacing.item) {
                            ForEach(upcoming) { b in
                                NavigationLink { TicketDetailView(booking: b) } label: { UpcomingTicketCard(booking: b) }.buttonStyle(.plain)
                            }
                        }
                        .pagePadding()
                    }
                }
            }
        case .promotion where !app.promotions.isEmpty:
            VStack(alignment: .leading, spacing: Spacing.header) {
                SectionHeader(section.title, subtitle: section.subtitle)
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: Spacing.item) {
                        ForEach(app.promotions) { promo in
                            PromotionCard(promotion: promo) { voucherToShow = $0 }
                        }
                    }
                    .scrollTargetLayout()
                    .pagePadding()
                }
                .scrollTargetBehavior(.viewAligned)
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
        VStack(alignment: .leading, spacing: Spacing.header) {
            SectionHeader(section.title, subtitle: section.subtitle) { FilmGridView(title: section.title, films: films) }
            ScrollView(.horizontal, showsIndicators: false) {
                LazyHStack(alignment: .top, spacing: Spacing.item) {
                    ForEach(films) { film in
                        NavigationLink(value: film) { PosterCard(film: film, size: .medium, caption: caption(film)) }.buttonStyle(.plain)
                    }
                }
                .pagePadding()
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
        VStack(alignment: .leading, spacing: Spacing.xs) {
            ArtworkImage(booking.film.backdrop ?? booking.film.poster)
                .frame(width: 300, height: 170)
                .overlay(alignment: .bottomLeading) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(booking.film.title).font(.headline)
                        Text("\(app.formatters.shortDate(booking.screening.startsAt, timeZone: booking.venue.timeZone)) · \(app.formatters.time(booking.screening.startsAt, timeZone: booking.venue.timeZone))")
                            .font(.subheadline)
                    }
                    .foregroundStyle(.white)
                    .padding(Spacing.m)
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
            PosterGrid(films: films).padding(.vertical, Spacing.m)
        }
        .background(palette.background)
        .navigationTitle(title)
        .navigationDestination(for: Film.self) { FilmDetailView(film: $0) }
    }
}

/// A voucher code the customer asked to see from a promotion.
struct VoucherCode: Identifiable, Hashable {
    let code: String
    let title: String
    var id: String { code }
}

/// Offer card on the home screen. Colours come from semantic tokens only.
struct PromotionCard: View {
    let promotion: Promotion
    let showVoucher: (VoucherCode) -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Environment(\.openURL) private var openURL

    private var film: Film? { if case .film(let id) = promotion.action { app.film(id: id) } else { nil } }

    /// "10% off", "£2 off" or "2 for 1" pulled from the title, shown big.
    private var headline: String? {
        let text = promotion.title
        for pattern in [#"\d+%\s*off"#, #"£\d+(?:\.\d{2})?\s*off"#, #"\d\s*for\s*\d"#] {
            if let r = text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) { return String(text[r]).uppercased() }
        }
        return nil
    }

    /// The title without the figure, so it isn't said twice ("New here?").
    private var lead: String {
        guard let h = headline, let r = promotion.title.range(of: h, options: .caseInsensitive) else { return promotion.title }
        return promotion.title.replacingCharacters(in: r, with: "").trimmingCharacters(in: .whitespacesAndNewlines.union(.init(charactersIn: "–-·,:")))
    }

    var body: some View {
        Group {
            if let film { filmCard(film) } else { offerCard }
        }
        .frame(width: 300, height: 236)
        .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    // MARK: Discount and link offers: a ticket with the saving front and centre.

    private var offerCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(lead.isEmpty ? "Offer" : lead.uppercased())
                    .font(.caption.weight(.heavy)).tracking(1.2)
                    .foregroundStyle(palette.actionPrimaryText.opacity(0.75))
                Text(headline ?? promotion.title)
                    .font(.system(size: headline == nil ? 26 : 40, weight: .black))
                    .minimumScaleFactor(0.6).lineLimit(2)
                    .foregroundStyle(palette.actionPrimaryText)
                Text(promotion.body)
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(palette.actionPrimaryText.opacity(0.85))
                    .lineLimit(2)
            }
            .padding(Spacing.m)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background {
                ZStack {
                    LinearGradient(colors: [palette.actionPrimary, palette.actionPrimary.mix(with: palette.background, by: 0.35)], startPoint: .topLeading, endPoint: .bottomTrailing)
                    // A soft spotlight for depth.
                    RadialGradient(colors: [palette.actionPrimaryText.opacity(0.18), .clear], center: .topTrailing, startRadius: 0, endRadius: 220)
                    Image(systemName: promotion.isVoucher ? "ticket.fill" : "sparkles")
                        .font(.system(size: 120, weight: .bold))
                        .foregroundStyle(palette.actionPrimaryText.opacity(0.08))
                        .rotationEffect(.degrees(-18))
                        .offset(x: 110, y: 20)
                        .accessibilityHidden(true)
                }
            }
            perforation
            HStack(spacing: Spacing.s) {
                if case .voucher(let code) = promotion.action {
                    Text(code)
                        .font(.subheadline.monospaced().weight(.bold))
                        .foregroundStyle(palette.textPrimary)
                        .padding(.horizontal, 10).padding(.vertical, 6)
                        .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(palette.textMuted, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
                        .accessibilityLabel("Code \(code.map(String.init).joined(separator: " "))")
                }
                Spacer(minLength: 0)
                if promotion.hasButton { action(filled: true) }
            }
            .padding(.horizontal, Spacing.m)
            .frame(height: 64)
            .background(palette.surfaceElevated)
        }
    }

    /// Ticket-stub edge between the offer and the code.
    private var perforation: some View {
        ZStack {
            palette.surfaceElevated
            Line().stroke(palette.border, style: StrokeStyle(lineWidth: 1, dash: [5, 4])).frame(height: 1).padding(.horizontal, 14)
            HStack {
                Circle().fill(palette.background).frame(width: 16, height: 16).offset(x: -8)
                Spacer()
                Circle().fill(palette.background).frame(width: 16, height: 16).offset(x: 8)
            }
        }
        .frame(height: 12)
        .accessibilityHidden(true)
    }

    // MARK: Film offers: the film's artwork, full bleed.

    private func filmCard(_ film: Film) -> some View {
        ZStack(alignment: .bottomLeading) {
            ArtworkImage(film.backdrop ?? film.poster, fallbackTitle: film.title)
                .frame(width: 300, height: 236)
                .clipped()
                .accessibilityHidden(true)
            LinearGradient(colors: [.clear, palette.artworkScrim.opacity(0.65), palette.artworkScrim.opacity(0.95)], startPoint: .top, endPoint: .bottom)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(promotion.title.uppercased())
                    .font(.caption.weight(.heavy)).tracking(1.2)
                    .foregroundStyle(palette.membership)
                    .lineLimit(1)
                Text(film.title)
                    .font(.title2.weight(.black))
                    .foregroundStyle(.white)
                    .lineLimit(1).minimumScaleFactor(0.7)
                Text(promotion.body)
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.85))
                    .lineLimit(2)
                if promotion.hasButton { action(filled: true).padding(.top, Spacing.xs) }
            }
            .padding(Spacing.m)
        }
    }

    @ViewBuilder
    private func action(filled: Bool) -> some View {
        let label = promotion.ctaLabel ?? ""
        switch promotion.action {
        case .voucher(let code):
            Button(label) { showVoucher(VoucherCode(code: code, title: promotion.title)) }
                .buttonStyle(OfferButtonStyle())
                .accessibilityHint("Shows the code \(code)")
        case .film(let id):
            if let film = app.film(id: id) {
                NavigationLink(value: film) { Text(label) }
                    .buttonStyle(OfferButtonStyle())
                    .accessibilityHint("Opens \(film.title)")
            }
        case .link(let url):
            Button(label) { openURL(url) }
                .buttonStyle(OfferButtonStyle())
                .accessibilityHint("Opens in Safari")
                .accessibilityAddTraits(.isLink)
        case .none:
            EmptyView()
        }
    }
}

/// Filled, high-contrast call to action for offers.
struct OfferButtonStyle: ButtonStyle {
    @Environment(\.palette) private var palette
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.bold))
            .lineLimit(1)
            .padding(.horizontal, Spacing.m)
            .frame(minHeight: 40)
            .foregroundStyle(palette.actionPrimaryText)
            .background(palette.actionPrimary, in: Capsule())
            .opacity(configuration.isPressed ? 0.8 : 1)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .contentShape(Capsule())
    }
}

private struct Line: Shape {
    func path(in rect: CGRect) -> Path { Path { p in p.move(to: CGPoint(x: 0, y: rect.midY)); p.addLine(to: CGPoint(x: rect.maxX, y: rect.midY)) } }
}

/// Shows a voucher code large enough to read out, with a copy button.
struct VoucherCodeSheet: View {
    let voucher: VoucherCode
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        VStack(spacing: Spacing.m) {
            Text(voucher.title)
                .font(.headline)
                .foregroundStyle(palette.textSecondary)
                .multilineTextAlignment(.center)
            Text(voucher.code)
                .font(.system(.largeTitle, design: .monospaced).weight(.bold))
                .foregroundStyle(palette.textPrimary)
                .textSelection(.enabled)
                .accessibilityLabel("Code \(voucher.code.map(String.init).joined(separator: " "))")
            Text("Enter it on the review screen before you pay.")
                .font(.subheadline)
                .foregroundStyle(palette.textMuted)
                .multilineTextAlignment(.center)
            Button(copied ? "Copied" : "Copy code") {
                UIPasteboard.general.string = voucher.code
                copied = true
                AccessibilityNotification.Announcement("Code copied").post()
            }
            .buttonStyle(.cinemaPrimary)
            .sensoryFeedback(.success, trigger: copied)
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity)
        .presentationDetents([.height(320)])
        .presentationBackground(palette.backgroundElevated)
    }
}
