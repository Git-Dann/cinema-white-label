import SwiftUI
import CinemaCore
import CinemaDesign

/// Menu, basket and the booking a pre-order is for. Prices on cards are the
/// menu's; the order sheet shows the server quote before anything is paid.
@MainActor
@Observable
final class FoodModel {
    private(set) var menu: ConcessionMenu?
    private(set) var menuVenueID: String?
    private(set) var error: String?
    private(set) var isLoading = false
    var basket = FoodBasket()
    /// The booking chosen for the pre-order, when the customer has more than one.
    var chosenBookingID: String?

    func load(venueID: String?, service: any CinemaService, force: Bool = false) async {
        guard let venueID else { menu = nil; menuVenueID = nil; return }
        if !force, venueID == menuVenueID, menu != nil { return }
        isLoading = true
        defer { isLoading = false }
        do {
            let m = try await service.concessions(venueId: venueID)
            if venueID != menuVenueID { basket.removeAll() }
            menu = m
            menuVenueID = venueID
            basket.keepOnly(in: m)
            error = nil
        } catch {
            self.error = (error as? APIError)?.message ?? "We couldn't load the menu right now."
        }
    }

    /// Bookings at the menu's cinema that can still take a pre-order, soonest first.
    func eligible(_ bookings: [Booking], now: Date = Date()) -> [Booking] {
        FoodPreorder.eligibleBookings(bookings, venueId: menuVenueID, now: now).filter { $0.venue.id == menuVenueID }
    }

    func target(_ bookings: [Booking]) -> Booking? {
        let list = eligible(bookings)
        return list.first { $0.id == chosenBookingID } ?? list.first
    }
}

struct FoodView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @State private var model = FoodModel()
    @State private var showingVenuePicker = false
    @State private var viewing: ConcessionProduct?
    @State private var showingOrder = false

    private var bookings: [Booking] { app.tickets.bookings }
    private var target: Booking? { model.target(bookings) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.section) {
                cinemaChip
                preorderCard.pagePadding()
                if let error = model.error {
                    InfoBanner(.error, error, actionTitle: "Retry") { Task { await reload(force: true) } }.pagePadding()
                }
                if let menu = model.menu {
                    if !menu.features.concessions || menu.isEmpty {
                        InfoBanner(.info, "Food and drink can't be pre-ordered at this cinema. You can still buy at the counter.").pagePadding()
                    } else {
                        content(menu)
                    }
                } else if model.isLoading {
                    LoadingView("Loading menu…")
                } else if app.selectedVenue == nil {
                    InfoBanner(.info, "Choose a cinema to see its menu.").pagePadding()
                }
            }
            .padding(.top, Spacing.xs)
            .padding(.bottom, Spacing.section)
        }
        .background(palette.background)
        .navigationTitle("Food & drink")
        .toolbarTitleDisplayMode(.inlineLarge)
        .refreshable { await reload(force: true); await app.tickets.refresh(using: app.service) }
        .task(id: app.selectedVenueID) { await reload() }
        .safeAreaInset(edge: .bottom) { basketBar }
        .sheet(isPresented: $showingVenuePicker) { VenuePickerSheet() }
        .sheet(item: $viewing) { product in
            ProductDetailSheet(product: product, canOrder: target != nil) { item in
                withAnimation(.snappy) { model.basket.add(item) }
            } onFindFilm: {
                AppNavigator.shared.requested = .films
            }
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $showingOrder) {
            if let target, let menu = model.menu {
                FoodOrderSheet(model: model, menu: menu, bookings: model.eligible(bookings), initial: target)
            }
        }
    }

    private func reload(force: Bool = false) async {
        await model.load(venueID: app.selectedVenueID, service: app.service, force: force)
    }

    // MARK: Header

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
        .accessibilityLabel("Menu for \(app.selectedVenue?.name ?? "no cinema selected")")
        .accessibilityHint("Changes your cinema")
    }

    /// Who the order is for: the next booking here, a booking at another cinema, or none yet.
    @ViewBuilder private var preorderCard: some View {
        if let b = target {
            HStack(spacing: Spacing.m) {
                ArtworkImage(b.film.poster, fallbackTitle: b.film.title)
                    .aspectRatio(2 / 3, contentMode: .fill)
                    .frame(width: 46, height: 69)
                    .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.small, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("PRE-ORDER FOR").font(.caption2.weight(.bold)).tracking(1.2).foregroundStyle(palette.actionPrimary)
                    Text(b.film.title).font(.headline).foregroundStyle(palette.textPrimary).lineLimit(1)
                    Text("\(app.formatters.dayAndTime(b.screening.startsAt, timeZone: b.venue.timeZone)) · Skip the queue")
                        .font(.subheadline).foregroundStyle(palette.textSecondary).lineLimit(1).minimumScaleFactor(0.85)
                }
                Spacer(minLength: 0)
                if model.eligible(bookings).count > 1 {
                    Menu {
                        Picker("Booking", selection: Binding(get: { target?.id }, set: { model.chosenBookingID = $0 })) {
                            ForEach(model.eligible(bookings)) { e in
                                Text("\(e.film.title), \(app.formatters.dayAndTime(e.screening.startsAt, timeZone: e.venue.timeZone))").tag(Optional(e.id))
                            }
                        }
                    } label: {
                        Text("Change").font(.subheadline.weight(.semibold))
                    }
                    .accessibilityLabel("Change which booking this order is for")
                }
            }
            .padding(Spacing.m)
            .background(palette.surfaceElevated, in: RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
            .accessibilityElement(children: .combine)
        } else if let elsewhere = FoodPreorder.eligibleBookings(bookings, venueId: nil).first {
            card(icon: "ticket.fill",
                 title: "Your \(elsewhere.film.title) tickets are at \(elsewhere.venue.name)",
                 text: "Switch to that cinema to pre-order food for your film.",
                 action: "Switch cinema") { app.selectedVenueID = elsewhere.venue.id }
        } else {
            card(icon: "popcorn.fill",
                 title: "Pre-order with your tickets",
                 text: "Book a film, then add food and drink here. It's ready at the counter when you arrive.",
                 action: "Find a film") { AppNavigator.shared.requested = .films }
        }
    }

    private func card(icon: String, title: String, text: String, action: String, perform: @escaping () -> Void) -> some View {
        VStack(alignment: .leading, spacing: Spacing.s) {
            HStack(alignment: .top, spacing: Spacing.s) {
                Image(systemName: icon).font(.title3).foregroundStyle(palette.actionPrimary).frame(width: 28).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.headline).foregroundStyle(palette.textPrimary)
                    Text(text).font(.subheadline).foregroundStyle(palette.textSecondary)
                }
            }
            Button(action, action: perform).buttonStyle(.cinemaCompact).padding(.leading, 28 + Spacing.s)
        }
        .padding(Spacing.m)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(palette.surfaceElevated, in: RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
    }

    // MARK: Menu

    @ViewBuilder private func content(_ menu: ConcessionMenu) -> some View {
        if !menu.specials.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.header) {
                header("Specials", subtitle: "Limited runs, seasonal treats and deals")
                ScrollView(.horizontal, showsIndicators: false) {
                    LazyHStack(spacing: Spacing.item) {
                        ForEach(menu.specials) { p in
                            Button { viewing = p } label: { SpecialCard(product: p) }
                                .buttonStyle(PressableCardStyle())
                        }
                    }
                    .scrollTargetLayout()
                }
                .contentMargins(.horizontal, Spacing.page, for: .scrollContent)
                .scrollTargetBehavior(.viewAligned)
                .scrollClipDisabled()
            }
        }
        ForEach(menu.filmTieIns, id: \.film.id) { group in
            VStack(alignment: .leading, spacing: Spacing.header) {
                header("For \(group.film.title)", subtitle: "Made for the film, while stocks last")
                VStack(spacing: Spacing.item) {
                    ForEach(group.items) { p in
                        Button { viewing = p } label: { TieInCard(product: p) }.buttonStyle(PressableCardStyle())
                    }
                }
                .pagePadding()
            }
        }
        ForEach(menu.categories) { category in
            VStack(alignment: .leading, spacing: Spacing.xs) {
                header(category.name, subtitle: nil)
                VStack(spacing: 0) {
                    ForEach(Array(category.items.enumerated()), id: \.element.id) { i, p in
                        if i > 0 { Divider().overlay(palette.divider).padding(.leading, 88 + Spacing.m) }
                        Button { viewing = p } label: { MenuRow(product: p) }.buttonStyle(.plain)
                    }
                }
                .background(palette.surface, in: RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
                .pagePadding()
            }
        }
    }

    private func header(_ title: String, subtitle: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.title2.weight(.bold)).foregroundStyle(palette.textPrimary).accessibilityAddTraits(.isHeader)
            if let subtitle { Text(subtitle).font(.subheadline).foregroundStyle(palette.textSecondary) }
        }
        .pagePadding()
    }

    // MARK: Basket bar

    @ViewBuilder private var basketBar: some View {
        if let menu = model.menu, !model.basket.isEmpty {
            Button { showingOrder = true } label: {
                HStack {
                    Text("\(model.basket.count)")
                        .font(.subheadline.weight(.bold)).monospacedDigit()
                        .frame(minWidth: 26, minHeight: 26)
                        .background(palette.actionPrimaryText.opacity(0.18), in: Circle())
                    Text(target == nil ? "Your order" : "Review order").font(.headline)
                    Spacer()
                    Text(app.formatters.money(model.basket.estimatedSubtotal(in: menu))).font(.headline).monospacedDigit()
                }
                .padding(.horizontal, Spacing.xs)
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.glassProminent)
            .tint(palette.actionPrimary)
            .controlSize(.large)
            .disabled(target == nil)
            .pagePadding()
            .padding(.bottom, Spacing.xs)
            .transition(.move(edge: .bottom).combined(with: .opacity))
            .accessibilityLabel("Review order, \(model.basket.count) items, \(app.formatters.money(model.basket.estimatedSubtotal(in: menu)))")
        }
    }
}

// MARK: - Cards

/// Price, the "was" price struck through, and the saving.
struct PriceTag: View {
    let product: ConcessionProduct
    var font: Font = .headline
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(product.isAvailable ? app.formatters.money(product.priceMinor) : "Sold out")
                .font(font.monospacedDigit())
                .foregroundStyle(product.isAvailable ? palette.textPrimary : palette.textMuted)
            if product.isAvailable, let was = product.compareAtMinor, product.savingMinor != nil {
                Text(app.formatters.money(was)).font(.subheadline.monospacedDigit()).strikethrough().foregroundStyle(palette.textMuted)
                    .accessibilityLabel("was \(app.formatters.money(was))")
            }
        }
    }
}

struct SavingChip: View {
    let amountMinor: Int
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    var body: some View {
        Text("Save \(app.formatters.money(amountMinor))")
            .font(.caption.weight(.bold))
            .foregroundStyle(palette.success)
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(palette.success.opacity(0.15), in: Capsule())
    }
}

struct BadgeLabel: View {
    let text: String
    var limited = false
    @Environment(\.palette) private var palette
    var body: some View {
        HStack(spacing: 4) {
            if limited { Image(systemName: "sparkles").font(.caption2.weight(.bold)) }
            Text(text.uppercased()).font(.caption2.weight(.heavy)).tracking(0.8)
        }
        .foregroundStyle(palette.membershipText)
        .padding(.horizontal, 8).padding(.vertical, 5)
        .background(palette.membership, in: Capsule())
    }
}

/// Large card in the Specials row.
struct SpecialCard: View {
    let product: ConcessionProduct
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ArtworkImage(product.image, fallbackTitle: product.name)
                .aspectRatio(4 / 3, contentMode: .fill)
                .frame(width: 280, height: 210)
                .clipped()
                .overlay(alignment: .topLeading) {
                    if let badge = product.displayBadge { BadgeLabel(text: badge, limited: product.isLimitedEdition).padding(Spacing.s) }
                }
                .opacity(product.isAvailable ? 1 : 0.55)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(product.name).font(.headline).foregroundStyle(palette.textPrimary).lineLimit(1)
                Text(product.isBundle ? product.bundleItems.joined(separator: " · ") : (product.description ?? product.film.map { "For \($0.title)" } ?? " "))
                    .font(.subheadline).foregroundStyle(palette.textSecondary).lineLimit(1)
                HStack {
                    PriceTag(product: product)
                    Spacer()
                    if product.isAvailable, let saving = product.savingMinor { SavingChip(amountMinor: saving) }
                }
                .padding(.top, Spacing.xxs)
            }
            .padding(Spacing.m)
        }
        .frame(width: 280)
        .background(palette.surfaceElevated)
        .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityHint("Shows details")
    }
}

/// Wide card for merchandise and food made for a film.
struct TieInCard: View {
    let product: ConcessionProduct
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: Spacing.m) {
            ArtworkImage(product.image, fallbackTitle: product.name)
                .aspectRatio(1, contentMode: .fill)
                .frame(width: 104, height: 104)
                .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.medium, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                if let badge = product.displayBadge { BadgeLabel(text: badge, limited: product.isLimitedEdition) }
                Text(product.name).font(.headline).foregroundStyle(palette.textPrimary).lineLimit(2).multilineTextAlignment(.leading)
                if product.isBundle { Text(product.bundleItems.joined(separator: " · ")).font(.footnote).foregroundStyle(palette.textSecondary).lineLimit(1) }
                PriceTag(product: product, font: .subheadline.weight(.semibold))
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote.weight(.bold)).foregroundStyle(palette.textMuted).accessibilityHidden(true)
        }
        .padding(Spacing.s)
        .background(palette.surfaceElevated, in: RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
        .contentShape(RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityHint("Shows details")
    }
}

struct MenuRow: View {
    let product: ConcessionProduct
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: Spacing.m) {
            ArtworkImage(product.image, fallbackTitle: nil)
                .aspectRatio(4 / 3, contentMode: .fill)
                .frame(width: 88, height: 66)
                .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.small, style: .continuous))
                .opacity(product.isAvailable ? 1 : 0.5)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(product.name).font(.body.weight(.semibold)).foregroundStyle(palette.textPrimary).lineLimit(1)
                    if product.isFeatured || product.isLimitedEdition {
                        Image(systemName: "sparkles").font(.caption.weight(.bold)).foregroundStyle(palette.membership).accessibilityLabel("Special")
                    }
                }
                Text(subtitle).font(.footnote).foregroundStyle(palette.textSecondary).lineLimit(1)
                if product.stockStatus == .low { Text("Low stock").font(.footnote.weight(.semibold)).foregroundStyle(palette.warning) }
            }
            Spacer(minLength: 0)
            PriceTag(product: product, font: .subheadline.weight(.semibold))
        }
        .padding(.horizontal, Spacing.m).padding(.vertical, Spacing.s)
        .frame(minHeight: Spacing.tap)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Shows details")
    }

    private var subtitle: String {
        if product.isBundle { return product.bundleItems.joined(separator: " · ") }
        let tags = product.dietary.joined(separator: ", ")
        return tags.isEmpty ? (product.description ?? product.modifierGroups.map(\.name).joined(separator: ", ")) : tags
    }
}
