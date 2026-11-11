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
            VStack(alignment: .leading, spacing: Spacing.section) {
                posterRow(section, films: app.nowShowing, caption: { $0.formats.contains("IMAX") ? "Also in IMAX" : $0.genres.first })
                recommendedRow
            }
        case .comingSoon where !app.comingSoon.isEmpty:
            posterRow(section, films: app.comingSoon, caption: { releaseCaption($0) })
        default:
            EmptyView()
        }
    }

    /// Pulse picks, placed under Now showing. Hidden when there is nothing the app can show.
    @ViewBuilder private var recommendedRow: some View {
        let picks = app.recommendedFilms
        if !picks.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.header) {
                SectionHeader("You might like", subtitle: app.recommendations.subtitle)
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: Spacing.item) {
                        ForEach(picks) { pick in
                            NavigationLink(value: pick.film) { PosterCard(film: pick.film, size: .medium, caption: pick.caption, captionLines: 2) }.buttonStyle(.plain)
                        }
                    }
                    .pagePadding()
                }
            }
            .accessibilityIdentifier("home.recommended")
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

    /// The offer's own photo, else (film offers) the film's artwork. Nil draws a type-only banner.
    private var artwork: ImageRef? { promotion.image ?? film?.backdrop ?? film?.poster }

    static let width: CGFloat = 320
    static let height: CGFloat = 212
    static let photoWidth: CGFloat = 132

    var body: some View {
        let lines = promotion.bannerLines(filmTitle: film?.title)
        // Shelf-edge offer: the brand colour fills the card, the saving is the biggest thing on it,
        // and a starburst sticker says what to do. Colours are semantic tokens with checked contrast.
        HStack(spacing: 0) {
            VStack(alignment: .leading, spacing: Spacing.xs) {
                if !lines.lead.isEmpty {
                    Text(lines.lead)
                        .font(.subheadline.weight(.bold))
                        .lineLimit(2)
                }
                Text(lines.headline)
                    .font(.system(size: lines.headline.count > 9 ? 30 : 42, weight: .black))
                    .lineLimit(2).minimumScaleFactor(0.55)
                    .accessibilityAddTraits(.isHeader)
                Text(promotion.body)
                    .font(.caption.weight(.medium))
                    .opacity(0.85)
                    .lineLimit(3)
                Spacer(minLength: 0)
                callToAction
            }
            .foregroundStyle(palette.actionPrimaryText)
            .padding(Spacing.m)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            ZStack(alignment: .topLeading) {
                if let artwork {
                    ArtworkImage(artwork, fallbackTitle: film?.title)
                        .frame(width: Self.photoWidth, height: Self.height)
                        .clipped()
                        .accessibilityHidden(true)
                } else {
                    palette.actionPrimaryText.opacity(0.12)
                }
                sticker
                    .offset(x: -26, y: 14)
            }
            .frame(width: Self.photoWidth, height: Self.height)
        }
        .frame(width: Self.width, height: Self.height)
        .background(palette.actionPrimary)
        .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
        .accessibilityElement(children: .contain)
    }

    /// Starburst roundel, stamped slightly askew over the photo's edge.
    private var sticker: some View {
        let words = promotion.stickerLines
        return VStack(spacing: 0) {
            ForEach(Array(words.enumerated()), id: \.offset) { i, w in
                Text(w)
                    .font(.system(size: i == words.count - 1 && words.count > 1 ? 13 : 11, weight: .black, design: words.count > 1 && i == 1 && promotion.isVoucher ? .monospaced : .default))
                    .lineLimit(1).minimumScaleFactor(0.6)
            }
        }
        .foregroundStyle(palette.actionPrimary)
        .padding(14)
        .frame(width: 92, height: 92)
        .background(Starburst(points: 18, innerRatio: 0.86).fill(palette.actionPrimaryText))
        .rotationEffect(.degrees(-12))
        .accessibilityHidden(true)
    }

    /// Inverted button, or for vouchers the whole code pill opens the code sheet.
    @ViewBuilder private var callToAction: some View {
        if case .voucher(let code) = promotion.action {
            Button { showVoucher(VoucherCode(code: code, title: promotion.title)) } label: {
                Label(promotion.ctaLabel ?? "Show code", systemImage: "ticket.fill")
            }
            .buttonStyle(OfferButtonStyle())
            .accessibilityHint("Shows the code \(code)")
        } else if promotion.hasButton {
            action(filled: true)
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
            // Inverted: it sits on the brand-coloured offer card.
            .foregroundStyle(palette.actionPrimary)
            .background(palette.actionPrimaryText, in: Capsule())
            .opacity(configuration.isPressed ? 0.8 : 1)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .contentShape(Capsule())
    }
}

/// A shelf-edge starburst: `points` spikes between the outer and inner radius.
struct Starburst: Shape {
    var points: Int
    var innerRatio: CGFloat

    func path(in rect: CGRect) -> Path {
        let c = CGPoint(x: rect.midX, y: rect.midY)
        let outer = min(rect.width, rect.height) / 2
        let inner = outer * innerRatio
        return Path { p in
            for i in 0..<(points * 2) {
                let r = i.isMultiple(of: 2) ? outer : inner
                let a = (CGFloat(i) / CGFloat(points * 2)) * 2 * .pi - .pi / 2
                let pt = CGPoint(x: c.x + cos(a) * r, y: c.y + sin(a) * r)
                if i == 0 { p.move(to: pt) } else { p.addLine(to: pt) }
            }
            p.closeSubpath()
        }
    }
}

/// Shows a voucher code large enough to read out, with a copy button.
struct VoucherCodeSheet: View {
    let voucher: VoucherCode
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false
    /// The content's height, so the sheet is exactly as tall as what it shows.
    @State private var contentHeight: CGFloat = 220

    var body: some View {
        // A system sheet left alone: Liquid Glass background, grabber, the system close button
        // and a system prominent button. Only the button takes the brand tint.
        NavigationStack {
            VStack(spacing: Spacing.s) {
                Text(voucher.code)
                    .font(.system(.largeTitle, design: .monospaced).weight(.bold))
                    .textSelection(.enabled)
                    .minimumScaleFactor(0.6).lineLimit(1)
                    .accessibilityLabel("Code \(voucher.code.map(String.init).joined(separator: " "))")
                Text("Enter it on the review screen before you pay.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Button {
                    UIPasteboard.general.string = voucher.code
                    copied = true
                    AccessibilityNotification.Announcement("Code copied").post()
                } label: {
                    Label(copied ? "Copied" : "Copy code", systemImage: copied ? "checkmark" : "doc.on.doc")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.glassProminent)
                .controlSize(.large)
                .padding(.top, Spacing.s)
                .sensoryFeedback(.success, trigger: copied)
            }
            .padding(.horizontal, Spacing.l)
            .padding(.bottom, Spacing.m)
            .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { contentHeight = $0 }
            .navigationTitle(voucher.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarTrailing) { Button(role: .close) { dismiss() }.tint(.primary) } }
        }
        // Content plus the navigation bar; never a fixed half-screen with empty space.
        .presentationDetents([.height(contentHeight + 72)])
        .presentationDragIndicator(.visible)
    }
}
