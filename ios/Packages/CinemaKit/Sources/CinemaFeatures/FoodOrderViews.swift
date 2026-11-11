import SwiftUI
import CinemaCore
import CinemaDesign

/// A product with its photo, story, choices and quantity. Without a booking to
/// attach it to, the button points to the films instead of adding.
struct ProductDetailSheet: View {
    let product: ConcessionProduct
    let canOrder: Bool
    let onAdd: (BasketItem) -> Void
    let onFindFilm: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    @State private var choices: [String: [String]] = [:]
    @State private var quantity = 1

    var body: some View {
        let problems = ModifierValidation.problems(product: product, modifiers: choices)
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.l) {
                ArtworkImage(product.image, fallbackTitle: product.name)
                    .aspectRatio(4 / 3, contentMode: .fill)
                    .frame(maxWidth: .infinity)
                    .clipped()
                    .overlay(alignment: .topLeading) {
                        if let badge = product.displayBadge { BadgeLabel(text: badge, limited: product.isLimitedEdition).padding(Spacing.m) }
                    }
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Spacing.s) {
                    if let film = product.film {
                        Label("For \(film.title)", systemImage: "film").font(.subheadline.weight(.semibold)).foregroundStyle(palette.actionPrimary)
                    }
                    Text(product.name).font(.title.weight(.bold)).foregroundStyle(palette.textPrimary).accessibilityAddTraits(.isHeader)
                    HStack {
                        PriceTag(product: product, font: .title3.weight(.semibold))
                        if product.isAvailable, let saving = product.savingMinor { SavingChip(amountMinor: saving) }
                    }
                    if let d = product.description { Text(d).font(.body).foregroundStyle(palette.textSecondary) }
                    if product.isBundle {
                        VStack(alignment: .leading, spacing: Spacing.xxs) {
                            ForEach(product.bundleItems, id: \.self) { Label($0, systemImage: "checkmark").font(.subheadline).foregroundStyle(palette.textPrimary) }
                        }
                        .padding(.top, Spacing.xxs)
                    }
                    if let facts = facts { Text(facts).font(.footnote).foregroundStyle(palette.textMuted) }
                    if product.isLimitedEdition { Text("Limited edition: while stocks last.").font(.footnote.weight(.semibold)).foregroundStyle(palette.warning) }
                }
                .pagePadding()

                if product.isAvailable {
                    ForEach(product.modifierGroups) { group in groupView(group) }
                    Stepper(value: $quantity, in: 1...20) {
                        Text("Quantity: \(quantity)").font(.headline).foregroundStyle(palette.textPrimary)
                    }
                    .pagePadding()
                }
            }
            .padding(.bottom, Spacing.section)
        }
        .ignoresSafeArea(edges: .top)
        .background(palette.background)
        .safeAreaInset(edge: .bottom) {
            Group {
                if !product.isAvailable {
                    Button("Sold out") {}.buttonStyle(.cinemaPrimary).disabled(true)
                } else if canOrder {
                    Button("Add to order · \(app.formatters.money(ModifierValidation.unitPrice(product: product, modifiers: choices) * quantity))") {
                        onAdd(BasketItem(productId: product.id, quantity: quantity, modifiers: choices))
                        dismiss()
                    }
                    .buttonStyle(.cinemaPrimary)
                    .disabled(!problems.isEmpty)
                    .accessibilityHint(problems.first ?? "Adds to your pre-order")
                } else {
                    Button("Book a film to pre-order") { dismiss(); onFindFilm() }.buttonStyle(.cinemaPrimary)
                }
            }
            .bottomActionPadding()
        }
        .sensoryFeedback(.selection, trigger: choices)
        .onAppear {
            // Preselect the first option of single-choice groups (e.g. Regular size).
            for g in product.modifierGroups where g.isSingleChoice { choices[g.id] = [g.options[0].id] }
        }
    }

    private var facts: String? {
        var parts: [String] = []
        if !product.dietary.isEmpty { parts.append(product.dietary.joined(separator: ", ")) }
        if !product.allergens.isEmpty { parts.append("Contains: \(product.allergens.joined(separator: ", "))") }
        if let c = product.calories, c > 0 { parts.append("\(c) kcal") }
        return parts.isEmpty ? nil : parts.joined(separator: " · ")
    }

    private func groupView(_ group: ConcessionProduct.ModifierGroup) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            HStack(alignment: .firstTextBaseline) {
                Text(group.name).font(.headline).foregroundStyle(palette.textPrimary)
                Spacer()
                Text(group.min == group.max ? "Choose \(group.min)" : (group.min == 0 ? "Optional, up to \(group.max)" : "Choose \(group.min) to \(group.max)"))
                    .font(.footnote).foregroundStyle(palette.textMuted)
            }
            .pagePadding()
            VStack(spacing: 0) {
                ForEach(Array(group.options.enumerated()), id: \.element.id) { i, option in
                    if i > 0 { Divider().overlay(palette.divider).padding(.leading, Spacing.m) }
                    let chosen = (choices[group.id] ?? []).contains(option.id)
                    Button { toggle(option.id, in: group) } label: {
                        HStack {
                            Image(systemName: group.isSingleChoice ? (chosen ? "largecircle.fill.circle" : "circle") : (chosen ? "checkmark.circle.fill" : "circle"))
                                .font(.title3)
                                .foregroundStyle(chosen ? palette.selected : palette.textMuted)
                            Text(option.name).foregroundStyle(palette.textPrimary)
                            Spacer()
                            if option.priceMinor > 0 { Text("+\(app.formatters.money(option.priceMinor))").foregroundStyle(palette.textSecondary).monospacedDigit() }
                        }
                        .padding(.horizontal, Spacing.m)
                        .frame(minHeight: Spacing.tap + 4)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(chosen ? .isSelected : [])
                }
            }
            .background(palette.surface, in: RoundedRectangle(cornerRadius: palette.cornerRadius.medium, style: .continuous))
            .pagePadding()
        }
    }

    private func toggle(_ id: String, in group: ConcessionProduct.ModifierGroup) {
        var current = choices[group.id] ?? []
        if group.isSingleChoice { current = [id] }
        else if let i = current.firstIndex(of: id) { current.remove(at: i) }
        else if current.count < group.max { current.append(id) }
        choices[group.id] = current
    }
}

/// Review the order against a booking, see the server price, pay, and confirm.
struct FoodOrderSheet: View {
    @Bindable var model: FoodModel
    let menu: ConcessionMenu
    let bookings: [Booking]
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    @State private var bookingID: String
    @State private var fulfilment: Fulfilment = .collect
    @State private var quote: FoodPreorderQuote?
    @State private var quoting = false
    @State private var paying = false
    @State private var message: String?
    @State private var confirmed: Booking?
    /// One key per payment attempt, so a retried tap after a network drop is not charged twice.
    @State private var attemptKey = UUID().uuidString

    init(model: FoodModel, menu: ConcessionMenu, bookings: [Booking], initial: Booking) {
        self.model = model; self.menu = menu; self.bookings = bookings
        _bookingID = State(initialValue: initial.id)
    }

    private var booking: Booking? { bookings.first { $0.id == bookingID } }

    var body: some View {
        NavigationStack {
            Group {
                if let confirmed { confirmation(confirmed) } else { review }
            }
            .background(palette.background)
            .navigationTitle(confirmed == nil ? "Your order" : "")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: confirmed == nil ? .cancellationAction : .confirmationAction) {
                    if confirmed == nil { Button(role: .close) { dismiss() }.tint(.primary) } else { Button(role: .confirm) { dismiss() } }
                }
            }
        }
        .task(id: QuoteKey(items: model.basket.items, bookingID: bookingID, fulfilment: fulfilment)) { await requote() }
    }

    private struct QuoteKey: Hashable { let items: [BasketItem]; let bookingID: String; let fulfilment: Fulfilment }

    private var review: some View {
        List {
            if let b = booking {
                Section {
                    if bookings.count > 1 {
                        Picker("For", selection: $bookingID) {
                            ForEach(bookings) { e in Text("\(e.film.title), \(app.formatters.dayAndTime(e.screening.startsAt, timeZone: e.venue.timeZone))").tag(e.id) }
                        }
                    } else {
                        LabeledContent("For", value: "\(b.film.title), \(app.formatters.dayAndTime(b.screening.startsAt, timeZone: b.venue.timeZone))")
                    }
                    if menu.features.seatDelivery {
                        Picker("How", selection: $fulfilment) {
                            Text("Collect").tag(Fulfilment.collect)
                            Text("To my seat").tag(Fulfilment.seatDelivery)
                        }
                        .pickerStyle(.segmented)
                    }
                } footer: {
                    Text(fulfilment == .seatDelivery
                         ? "Brought to \(b.seatSummary) after the trailers."
                         : "Ready at the counter at \(b.venue.name). Show your ticket. Pre-orders close \(app.formatters.time(b.preorder?.closesAt ?? b.screening.startsAt, timeZone: b.venue.timeZone)).")
                }
            }

            Section("Items") {
                ForEach(model.basket.items) { item in itemRow(item) }
            }

            if let message { Section { InfoBanner(.error, message).listRowBackground(Color.clear).listRowInsets(EdgeInsets()) } }

            Section {
                if let q = quote {
                    LabeledContent("Food and drink", value: app.formatters.money(q.subtotalMinor))
                    ForEach(q.discounts, id: \.self) { d in
                        LabeledContent(d.label, value: "−\(app.formatters.money(d.amountMinor))").foregroundStyle(palette.success)
                    }
                    LabeledContent { Text(app.formatters.money(q.totalMinor)).font(.headline.monospacedDigit()) } label: { Text("Total").font(.headline) }
                    if q.pointsToEarn > 0 { Label("You'll earn \(q.pointsToEarn) points", systemImage: "sparkles").font(.footnote).foregroundStyle(palette.textSecondary) }
                } else if quoting {
                    HStack { ProgressView(); Text("Getting the price…").foregroundStyle(palette.textMuted) }
                }
            } footer: {
                Text("Simulated payment: no card is charged in this build.")
            }
        }
        .scrollContentBackground(.hidden)
        .safeAreaInset(edge: .bottom) {
            Button {
                Task { await pay() }
            } label: {
                if paying { ProgressView().tint(palette.actionPrimaryText) } else { Text(quote.map { "Pay \(app.formatters.money($0.totalMinor))" } ?? "Pay") }
            }
            .buttonStyle(.cinemaPrimary)
            .disabled(quote == nil || paying || quoting || model.basket.isEmpty)
            .bottomActionPadding()
        }
    }

    private func itemRow(_ item: BasketItem) -> some View {
        let product = menu.product(id: item.productId)
        let options = product.map { p in p.modifierGroups.flatMap { g in g.options.filter { (item.modifiers[g.id] ?? []).contains($0.id) }.map(\.name) } } ?? []
        return HStack(spacing: Spacing.s) {
            ArtworkImage(product?.image, fallbackTitle: nil)
                .aspectRatio(1, contentMode: .fill)
                .frame(width: 44, height: 44)
                .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.small, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(product?.name ?? "Item").foregroundStyle(palette.textPrimary)
                if !options.isEmpty { Text(options.joined(separator: ", ")).font(.footnote).foregroundStyle(palette.textMuted) }
            }
            Spacer()
            Stepper("Quantity \(item.quantity)", value: Binding(get: { item.quantity }, set: { q in withAnimation { model.basket.setQuantity(q, for: item.id) }; if model.basket.isEmpty { dismiss() } }), in: 0...20)
                .labelsHidden()
            Text("\(item.quantity)").monospacedDigit().frame(minWidth: 20)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAdjustableAction { direction in
            model.basket.setQuantity(item.quantity + (direction == .increment ? 1 : -1), for: item.id)
        }
    }

    private func confirmation(_ b: Booking) -> some View {
        VStack(spacing: Spacing.l) {
            Spacer()
            Image(systemName: "checkmark.circle.fill").font(.system(size: 64)).foregroundStyle(palette.success).symbolEffect(.bounce, value: confirmed)
            VStack(spacing: Spacing.xs) {
                Text("Added to your booking").font(.title2.weight(.bold)).foregroundStyle(palette.textPrimary)
                Text(b.fulfilment == .seatDelivery
                     ? "We'll bring it to \(b.seatSummary) after the trailers for \(b.film.title)."
                     : "Collect it at the counter at \(b.venue.name) when you arrive for \(b.film.title). Show your ticket.")
                    .multilineTextAlignment(.center).foregroundStyle(palette.textSecondary)
            }
            .pagePadding()
            Spacer()
            Button("View ticket") {
                dismiss()
                AppNavigator.shared.requestedBookingId = b.id
                AppNavigator.shared.requested = .tickets
            }
            .buttonStyle(.cinemaPrimary)
            .bottomActionPadding()
        }
        .sensoryFeedback(.success, trigger: confirmed)
    }

    private func requote() async {
        guard !model.basket.isEmpty else { quote = nil; return }
        quoting = true
        defer { quoting = false }
        // Any change to the order is a new purchase, so it gets a new key.
        attemptKey = UUID().uuidString
        do {
            quote = try await app.service.quoteFoodPreorder(bookingId: bookingID, items: model.basket.items, fulfilment: fulfilment)
            message = nil
        } catch {
            quote = nil
            message = (error as? APIError)?.message ?? "We couldn't price your order. Check your connection and try again."
        }
    }

    private func pay() async {
        paying = true
        defer { paying = false }
        do {
            let updated = try await app.service.placeFoodPreorder(bookingId: bookingID, items: model.basket.items, fulfilment: fulfilment, simulateDecline: false, idempotencyKey: attemptKey)
            app.tickets.insert(updated)
            Task { await app.loadAccount() }
            withAnimation(.snappy) {
                confirmed = updated
                model.basket.removeAll()
            }
        } catch let e as APIError where e.code == .paymentDeclined {
            attemptKey = UUID().uuidString
            message = e.message
        } catch {
            // Unknown outcome: keep the same key so trying again cannot charge twice.
            message = (error as? APIError)?.message ?? "We couldn't confirm your order. Try again; you won't be charged twice."
        }
    }
}
