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
        .sheet(item: $voucherToShow) { VoucherCodeSheet(voucher: $0) }
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
        case .promotion where !app.promotions.isEmpty:
            VStack(alignment: .leading, spacing: 14) {
                SectionHeader(section.title, subtitle: section.subtitle)
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(alignment: .top, spacing: 16) {
                        ForEach(app.promotions) { promo in
                            PromotionCard(promotion: promo) { voucherToShow = $0 }
                        }
                    }
                    .scrollTargetLayout()
                    .padding(.horizontal, 20)
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

    private var symbol: String {
        switch promotion.action {
        case .voucher: return "ticket"
        case .film: return "film"
        case .link: return "safari"
        case .none: return "megaphone"
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: symbol)
                .font(.title3.weight(.semibold))
                .foregroundStyle(palette.actionPrimary)
                .accessibilityHidden(true)
            Text(promotion.title)
                .font(.headline)
                .foregroundStyle(palette.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Text(promotion.body)
                .font(.subheadline)
                .foregroundStyle(palette.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if promotion.hasButton { action }
        }
        .padding(18)
        .frame(width: 280, alignment: .leading)
        .frame(minHeight: 200, alignment: .topLeading)
        .background(palette.surfaceElevated, in: RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous).strokeBorder(palette.border))
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private var action: some View {
        let label = promotion.ctaLabel ?? ""
        switch promotion.action {
        case .voucher(let code):
            Button(label) { showVoucher(VoucherCode(code: code, title: promotion.title)) }
                .buttonStyle(.cinemaGlass)
                .accessibilityHint("Shows the code \(code)")
        case .film(let id):
            // Only offer the button when the film is in the loaded catalogue.
            if let film = app.film(id: id) {
                NavigationLink(value: film) { Text(label) }
                    .buttonStyle(.cinemaGlass)
                    .accessibilityHint("Opens \(film.title)")
            }
        case .link(let url):
            Button(label) { openURL(url) }
                .buttonStyle(.cinemaGlass)
                .accessibilityHint("Opens in Safari")
                .accessibilityAddTraits(.isLink)
        case .none:
            EmptyView()
        }
    }
}

/// Shows a voucher code large enough to read out, with a copy button.
struct VoucherCodeSheet: View {
    let voucher: VoucherCode
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        VStack(spacing: 18) {
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
        .padding(24)
        .frame(maxWidth: .infinity)
        .presentationDetents([.height(320)])
        .presentationBackground(palette.backgroundElevated)
    }
}
