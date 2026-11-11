import SwiftUI
import CinemaCore
import CinemaDesign
import CinemaSeatMap

enum BookingFlowResult { case confirmed(Booking), cancelled }

/// Entry point: loads the screening and live availability, then hosts the
/// focused flow. The models are created once here and survive any size change.
struct BookingFlowView: View {
    let request: BookingRequest
    let onFinish: (BookingFlowResult) -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @State private var flow: BookingFlowModel?
    @State private var loadError: String?

    var body: some View {
        NavigationStack {
            Group {
                if let flow {
                    BookingStepsView(flow: flow, onFinish: onFinish)
                } else if let loadError {
                    ContentUnavailableView {
                        Label("Couldn't open this screening", systemImage: "exclamationmark.triangle")
                    } description: { Text(loadError) } actions: {
                        Button("Try again") { Task { await load() } }
                    }
                } else {
                    LoadingView("Loading seats…")
                }
            }
            .background(palette.background)
            .toolbar {
                if flow == nil {
                    ToolbarItem(placement: .cancellationAction) { Button("Close") { onFinish(.cancelled) } }
                }
            }
        }
        .task { await load() }
    }

    private func load() async {
        loadError = nil
        do {
            async let detail = app.service.screening(id: request.screeningId)
            async let availability = app.service.availability(screeningId: request.screeningId)
            let (d, a) = try await (detail, availability)
            let selection = SeatSelectionModel(screening: d, availability: a, maxTickets: app.config.booking.maxTicketsPerBooking)
            flow = BookingFlowModel(service: app.service, selection: selection, formatters: app.formatters, analytics: app.analytics)
            await app.analytics.record(.seatSelectorOpened, ["screeningId": d.id])
        } catch {
            loadError = (error as? APIError)?.message ?? "Please check your connection."
        }
    }
}

struct BookingStepsView: View {
    @Bindable var flow: BookingFlowModel
    let onFinish: (BookingFlowResult) -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette

    var body: some View {
        content
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if flow.step == .seats || flow.step == .confirmed {
                        Button(flow.step == .confirmed ? "Done" : "Close") {
                            if let b = flow.booking { onFinish(.confirmed(b)) } else {
                                Task { await flow.abandon() }
                                onFinish(.cancelled)
                            }
                        }
                    } else {
                        Button { flow.goBack() } label: { Label("Back", systemImage: "chevron.backward") }
                    }
                }
                if flow.step == .tickets || flow.step == .food || flow.step == .review {
                    ToolbarItem(placement: .principal) {
                        VStack(spacing: 0) {
                            Text(title).font(.headline).foregroundStyle(palette.textPrimary)
                            HoldCountdown(flow: flow)
                        }
                        .accessibilityElement(children: .combine)
                    }
                }
            }
            .overlay {
                if case .working(let text) = flow.phase {
                    ZStack { Color.black.opacity(0.35).ignoresSafeArea(); LoadingView(text).foregroundStyle(.white) }
                        .accessibilityAddTraits(.isModal)
                }
            }
            .alert(failureTitle, isPresented: failureBinding, presenting: currentFailure) { failure in
                Button(recoveryTitle(failure.recovery)) { Task { await flow.recover() } }
                if failure.recovery == .retry { Button("Cancel", role: .cancel) { flow.dismissFailure() } }
            } message: { Text($0.message) }
            .animation(.smooth, value: flow.step)
    }

    @ViewBuilder
    private var content: some View {
        switch flow.step {
        case .seats: SeatSelectionScreen(flow: flow)
        case .tickets: TicketTypesScreen(flow: flow)
        case .food: FoodScreen(flow: flow)
        case .review: ReviewScreen(flow: flow)
        case .confirmed: ConfirmationScreen(flow: flow) { if let b = flow.booking { onFinish(.confirmed(b)) } }
        }
    }

    private var title: String {
        switch flow.step { case .seats: "Choose Seats"; case .tickets: "Tickets"; case .food: "Food & Drink"; case .review: "Review"; case .confirmed: "Booked" }
    }

    private var currentFailure: BookingFlowModel.Failure? { if case .failed(let f) = flow.phase { f } else { nil } }
    private var failureBinding: Binding<Bool> { Binding(get: { currentFailure != nil }, set: { if !$0 { flow.dismissFailure() } }) }
    private var failureTitle: String { currentFailure?.recovery == .retry ? "Something went wrong" : "Please choose again" }
    private func recoveryTitle(_ r: BookingFlowModel.Failure.Recovery) -> String {
        switch r { case .chooseOtherSeats: "Choose seats"; case .startAgain: "Choose seats again"; case .retry: "Try again"; case .dismiss: "OK" }
    }
}

/// Server-derived hold countdown, announced to VoiceOver at key moments.
struct HoldCountdown: View {
    let flow: BookingFlowModel
    @Environment(\.palette) private var palette

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            if let s = flow.secondsRemaining(now: context.date) {
                Label(s > 0 ? "\(flow.formatters.countdown(s)) left" : "Expired", systemImage: "timer")
                    .labelStyle(.titleAndIcon)
                    .font(.caption.monospacedDigit().weight(.semibold))
                    .foregroundStyle(s < 60 ? palette.warning : palette.textSecondary)
                    .accessibilityLabel(s > 0 ? "Seats reserved for \(s / 60) minutes \(s % 60) seconds" : "Reservation expired")
                    .onChange(of: s == 60) { _, oneMinute in
                        if oneMinute { AccessibilityNotification.Announcement("One minute left to complete your booking").post() }
                    }
            }
        }
    }
}

// MARK: - Seats

struct SeatSelectionScreen: View {
    @Bindable var flow: BookingFlowModel
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityVoiceOverEnabled) private var voiceOver
    @State private var mode: Mode = .map
    @State private var live = LiveAvailability()

    enum Mode: String { case map, list }

    var selection: SeatSelectionModel { flow.selection }

    var body: some View {
        // Expanded widths (iPhone Duo inner display, iPad, landscape) get a side
        // panel; compact widths a bottom summary. Same models either way.
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 0) {
                mapArea
                Divider()
                ScrollView { summary.padding(Spacing.page) }
                    .frame(width: 340)
                    .background(palette.backgroundElevated)
            }
            .frame(minWidth: 720)
            VStack(spacing: 0) { mapArea }
                .safeAreaInset(edge: .bottom) {
                    summary
                        .padding(Spacing.card)
                        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
                        .padding(.horizontal, Spacing.s)
                }
        }
        .background(palette.background)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Picker("View", selection: $mode) {
                    Label("Map", systemImage: "square.grid.3x3").tag(Mode.map)
                    Label("List", systemImage: "list.bullet").tag(Mode.list)
                }
                .pickerStyle(.menu)
                .accessibilityLabel("Seat view: \(mode == .map ? "map" : "list")")
            }
        }
        .onAppear { if voiceOver { mode = .list } }
        .task { await live.run(flow: flow, app: app) }
        .sensoryFeedback(.selection, trigger: selection.selectedSeatIds)
        .sensoryFeedback(.warning, trigger: selection.conflicts.count) { _, new in new > 0 }
    }

    private var mapArea: some View {
        VStack(spacing: 0) {
            header
            if selection.availability.values.allSatisfy({ $0 != .available }) && selection.selectedSeatIds.isEmpty {
                ContentUnavailableView("Sold out", systemImage: "ticket", description: Text("There are no seats left for this showing. Try another time."))
            } else if mode == .map {
                SeatMapContainer(model: selection, formatters: flow.formatters, onToggle: { seat, result in
                    if case .selected = result {
                        Task { await app.analytics.record(.seatSelected, ["screeningId": flow.screening.id, "category": seat.priceCategory]) }
                    }
                }, onZoom: { method in
                    Task { await app.analytics.record(.seatMapZoomed, ["screeningId": flow.screening.id, "method": method]) }
                })
                SeatLegend(model: selection, formatters: flow.formatters).padding(.vertical, Spacing.s)
            } else {
                SeatListView(model: selection, formatters: flow.formatters)
            }
        }
    }

    private var header: some View {
        let s = flow.screening
        return VStack(spacing: Spacing.xxs) {
            Text(s.film.title).font(.headline).foregroundStyle(palette.textPrimary)
            Text("\(flow.formatters.shortDate(s.startsAt, timeZone: s.venue.timeZone)) · \(flow.formatters.time(s.startsAt, timeZone: s.venue.timeZone)) · \(s.auditorium.name) · \(s.formats.joined(separator: " "))")
                .font(.subheadline).foregroundStyle(palette.textMuted)
                .lineLimit(1).minimumScaleFactor(0.8)
        }
        .pagePadding()
        .padding(.vertical, Spacing.xs)
        .accessibilityElement(children: .combine)
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 12) {
            if let reason = selection.blockingReason, reason != selection.message?.text {
                InfoBanner(.warning, reason)
            } else if selection.message == nil, let warning = selection.validation.warnings.first(where: { $0.code == "orphan_seat" }) {
                InfoBanner(.info, warning.message)
            }
            if let m = selection.message {
                InfoBanner(m.kind == .error ? .error : m.kind == .warning ? .warning : .info, m.text,
                           actionTitle: selection.conflicts.isEmpty ? nil : "Remove",
                           action: selection.conflicts.isEmpty ? nil : { selection.removeConflicts() })
            }
            if live.isPolling {
                Text("Live updates paused; refreshing every few seconds.").font(.caption).foregroundStyle(palette.textMuted)
            }
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(selection.selectedSeatIds.isEmpty ? "No seats selected" : "\(selection.selectedSeatIds.count) \(selection.selectedSeatIds.count == 1 ? "seat" : "seats") · \(selection.selectionSummary)")
                        .font(.headline).foregroundStyle(palette.textPrimary)
                    Text(selection.selectedSeatIds.isEmpty ? "Tap a seat to choose it" : "Estimated \(flow.formatters.money(selection.estimatedTotalMinor)) incl. fees")
                        .font(.subheadline).foregroundStyle(palette.textMuted)
                }
                Spacer()
            }
            .accessibilityElement(children: .combine)
            Button {
                Task { await flow.reserveSeats() }
            } label: { Text("Continue") }
                .buttonStyle(.cinemaPrimary)
                .disabled(!selection.canContinue)
        }
    }
}

/// Live availability: server-sent events with an automatic polling fallback.
@MainActor
@Observable
final class LiveAvailability {
    private(set) var isPolling = false

    func run(flow: BookingFlowModel, app: AppModel) async {
        let screeningId = flow.screening.id
        let url = app.service is LiveCinemaService ? (app.service as! LiveCinemaService).client.tenantURL("/screenings/\(screeningId)/availability/stream") : nil
        while !Task.isCancelled {
            if let url {
                isPolling = false
                do {
                    var request = URLRequest(url: url)
                    request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                    request.timeoutInterval = 60
                    let (bytes, _) = try await URLSession.shared.bytes(for: request)
                    for try await line in bytes.lines where line.hasPrefix("data:") {
                        let json = Data(line.dropFirst(5).utf8)
                        if let change = try? APIClient.decoder.decode(AvailabilityChange.self, from: json) {
                            flow.selection.apply(change: change, ownHoldSeatIds: flow.ownHoldSeatIds)
                        }
                    }
                } catch {}
            }
            // Stream ended or unavailable: poll until it can be re-established.
            // Only tell the customer when a live stream was expected (not in demo mode).
            isPolling = url != nil
            for _ in 0..<3 where !Task.isCancelled {
                if let snapshot = try? await app.service.availability(screeningId: screeningId) {
                    flow.selection.apply(snapshot: snapshot, ownHoldSeatIds: flow.ownHoldSeatIds)
                }
                try? await Task.sleep(for: .seconds(8))
            }
        }
    }
}

// MARK: - Tickets

struct TicketTypesScreen: View {
    @Bindable var flow: BookingFlowModel
    @Environment(\.palette) private var palette

    var body: some View {
        List {
            ForEach(flow.holdWarnings, id: \.code) { w in
                InfoBanner(.info, w.message).listRowBackground(Color.clear)
            }
            Section {
                ForEach(flow.selection.selectedSeats) { seat in
                    let options = flow.ticketTypeOptions(for: seat)
                    Picker(selection: Binding(get: { flow.ticketTypes[seat.id] ?? "" }, set: { id in Task { await flow.setTicketType(id, for: seat.id) } })) {
                        ForEach(options) { t in
                            Text("\(t.name) · \(flow.formatters.money(flow.pricing.price(for: t, category: seat.priceCategory) ?? 0))").tag(t.id)
                        }
                    } label: {
                        VStack(alignment: .leading) {
                            Text("Row \(flow.selection.rowLabel(for: seat)), Seat \(seat.label)").foregroundStyle(palette.textPrimary)
                            Text(flow.selection.category(for: seat).label)
                                .font(.footnote).foregroundStyle(palette.textMuted)
                        }
                    }
                }
            } header: { Text("Who's coming?") } footer: {
                if flow.pricing.ticketTypes.contains(where: \.requiresProof) { Text("Student and senior tickets may need ID at the door.") }
            }
            if let q = flow.quote {
                Section("Price") { PriceBreakdown(quote: q, formatters: flow.formatters) }
            }
        }
        .scrollContentBackground(.hidden)
        .background(palette.background)
        .safeAreaInset(edge: .bottom) {
            Button("Review booking") { flow.continueToReview() }
                .buttonStyle(.cinemaPrimary)
                .disabled(flow.quote == nil)
                .bottomActionPadding()
        }
    }
}

struct PriceBreakdown: View {
    let quote: Quote
    let formatters: Formatters
    @Environment(\.palette) private var palette

    var body: some View {
        ForEach(quote.lines, id: \.seatId) { l in
            line("\(l.ticketTypeName) · \(l.rowLabel)\(l.seatLabel)" + (l.supplementsMinor > 0 ? " (incl. \(formatters.money(l.supplementsMinor)) format)" : ""), l.priceMinor)
        }
        ForEach(quote.concessions ?? [], id: \.self) { c in
            line("\(c.quantity) × \(c.name)", c.lineTotalMinor)
        }
        if quote.feesMinor > 0 { line(quote.feeLabel ?? "Fees", quote.feesMinor) }
        if let m = quote.membership, m.feeWaivedMinor > 0 {
            HStack {
                Text("Booking fee").foregroundStyle(palette.textSecondary)
                Spacer()
                Text("Waived for members").foregroundStyle(palette.success)
            }
            .accessibilityElement(children: .combine)
        }
        if let discounts = quote.discounts, !discounts.isEmpty {
            ForEach(discounts, id: \.self) { d in line(d.kind == "voucher" ? "Voucher \(quote.voucher?.code ?? ""): \(d.label)" : d.label, -d.amountMinor) }
        } else if quote.discountMinor > 0 {
            line(quote.voucher.map { "Voucher \($0.code)" } ?? "Discount", -quote.discountMinor)
        }
        HStack {
            Text("Total").font(.headline)
            Spacer()
            Text(formatters.money(quote.totalMinor)).font(.headline.monospacedDigit())
        }
        .foregroundStyle(palette.textPrimary)
        .accessibilityElement(children: .combine)
    }

    private func line(_ label: String, _ minor: Int) -> some View {
        HStack {
            Text(label).foregroundStyle(palette.textSecondary)
            Spacer()
            Text(formatters.money(minor)).monospacedDigit().foregroundStyle(palette.textPrimary)
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Food and drink

struct FoodScreen: View {
    @Bindable var flow: BookingFlowModel
    @Environment(\.palette) private var palette
    @State private var configuring: ConcessionProduct?

    var body: some View {
        List {
            if let message = flow.basketMessage {
                InfoBanner(.error, message).listRowBackground(Color.clear)
            }
            if let menu = flow.menu {
                ForEach(menu.categories) { category in
                    Section(category.name) {
                        ForEach(category.items) { product in productRow(product) }
                    }
                }
            } else {
                LoadingView("Loading menu…").listRowBackground(Color.clear)
            }
            if !flow.basket.isEmpty {
                Section("Your order") {
                    ForEach(flow.basket) { item in basketRow(item) }
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(palette.background)
        .sheet(item: $configuring) { product in
            ProductOptionsSheet(product: product, formatters: flow.formatters) { item in
                Task { await flow.addToBasket(item) }
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .safeAreaInset(edge: .bottom) {
            Button(flow.basket.isEmpty ? "Skip" : "Continue · \(flow.quote.map { flow.formatters.money($0.totalMinor) } ?? "")") { flow.continueToReview() }
                .buttonStyle(.cinemaPrimary)
                .bottomActionPadding()
        }
    }

    private func productRow(_ p: ConcessionProduct) -> some View {
        Button {
            if p.modifierGroups.isEmpty { Task { await flow.addToBasket(BasketItem(productId: p.id)) } } else { configuring = p }
        } label: {
            HStack(alignment: .top, spacing: Spacing.s) {
                ArtworkImage(p.image, fallbackTitle: nil)
                    .frame(width: 72, height: 54)
                    .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.small, style: .continuous))
                    .opacity(p.isAvailable ? 1 : 0.5)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(p.name).font(.headline).foregroundStyle(palette.textPrimary)
                    if !p.bundleItems.isEmpty { Text(p.bundleItems.joined(separator: " · ")).font(.subheadline).foregroundStyle(palette.textSecondary) }
                    Text(([p.dietary.joined(separator: ", ")] + (p.allergens.isEmpty ? [] : ["Contains: \(p.allergens.joined(separator: ", "))"])).filter { !$0.isEmpty }.joined(separator: " · "))
                        .font(.footnote).foregroundStyle(palette.textMuted)
                    if p.stockStatus == .low { Text("Low stock").font(.footnote.weight(.semibold)).foregroundStyle(palette.warning) }
                }
                Spacer()
                VStack(alignment: .trailing) {
                    Text(p.isAvailable ? flow.formatters.money(p.priceMinor) : "Sold out").font(.headline.monospacedDigit())
                        .foregroundStyle(p.isAvailable ? palette.textPrimary : palette.textMuted)
                    if p.isAvailable { Image(systemName: "plus.circle.fill").font(.title2).foregroundStyle(palette.actionPrimary).accessibilityHidden(true) }
                }
            }
            .frame(minHeight: 44)
        }
        .disabled(!p.isAvailable)
        .accessibilityHint(p.modifierGroups.isEmpty ? "Adds to your order" : "Choose options")
    }

    private func basketRow(_ item: BasketItem) -> some View {
        let product = flow.product(for: item)
        let options = product.map { p in p.modifierGroups.flatMap { g in g.options.filter { (item.modifiers[g.id] ?? []).contains($0.id) }.map(\.name) } } ?? []
        return HStack {
            VStack(alignment: .leading) {
                Text(product?.name ?? "Item").foregroundStyle(palette.textPrimary)
                if !options.isEmpty { Text(options.joined(separator: ", ")).font(.footnote).foregroundStyle(palette.textMuted) }
            }
            Spacer()
            Stepper("Quantity \(item.quantity)", value: Binding(get: { item.quantity }, set: { q in Task { await flow.setQuantity(q, for: item.id) } }), in: 0...20)
                .labelsHidden()
            Text("\(item.quantity)").monospacedDigit().frame(minWidth: 20)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAdjustableAction { direction in
            Task { await flow.setQuantity(item.quantity + (direction == .increment ? 1 : -1), for: item.id) }
        }
    }
}

/// Modifier choices with min/max validation before adding to the order.
struct ProductOptionsSheet: View {
    let product: ConcessionProduct
    let formatters: Formatters
    let onAdd: (BasketItem) -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette
    @State private var choices: [String: [String]] = [:]
    @State private var quantity = 1

    var body: some View {
        NavigationStack {
            Form {
                ForEach(product.modifierGroups) { group in
                    Section {
                        ForEach(group.options) { option in
                            let chosen = (choices[group.id] ?? []).contains(option.id)
                            Button { toggle(option.id, in: group) } label: {
                                HStack {
                                    Image(systemName: group.isSingleChoice ? (chosen ? "largecircle.fill.circle" : "circle") : (chosen ? "checkmark.square.fill" : "square"))
                                        .foregroundStyle(chosen ? palette.selected : palette.textMuted)
                                    Text(option.name).foregroundStyle(palette.textPrimary)
                                    Spacer()
                                    if option.priceMinor > 0 { Text("+\(formatters.money(option.priceMinor))").foregroundStyle(palette.textSecondary) }
                                }
                            }
                            .accessibilityAddTraits(chosen ? .isSelected : [])
                        }
                    } header: { Text(group.name) } footer: {
                        Text(group.min == group.max ? "Choose \(group.min)" : "Choose up to \(group.max)")
                    }
                }
                Section { Stepper("Quantity: \(quantity)", value: $quantity, in: 1...20) }
            }
            .navigationTitle(product.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(role: .cancel) { dismiss() } } }
            .safeAreaInset(edge: .bottom) {
                let problems = ModifierValidation.problems(product: product, modifiers: choices)
                Button("Add · \(formatters.money(ModifierValidation.unitPrice(product: product, modifiers: choices) * quantity))") {
                    onAdd(BasketItem(productId: product.id, quantity: quantity, modifiers: choices))
                    dismiss()
                }
                .buttonStyle(.cinemaPrimary)
                .disabled(!problems.isEmpty)
                .accessibilityHint(problems.first ?? "")
                .bottomActionPadding()
            }
        }
        .onAppear {
            // Preselect the first option of single-choice groups (e.g. Regular size).
            for g in product.modifierGroups where g.isSingleChoice { choices[g.id] = [g.options[0].id] }
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

// MARK: - Review and pay

struct ReviewScreen: View {
    @Bindable var flow: BookingFlowModel
    @Environment(\.palette) private var palette
    #if DEBUG
    @State private var simulateDecline = false
    #endif

    var body: some View {
        let s = flow.screening
        List {
            Section {
                LabeledContent("Film", value: s.film.title)
                LabeledContent("When", value: "\(flow.formatters.longDate(s.startsAt, timeZone: s.venue.timeZone)), \(flow.formatters.time(s.startsAt, timeZone: s.venue.timeZone))")
                LabeledContent("Cinema", value: s.venue.name)
                LabeledContent("Screen", value: s.auditorium.name)
                LabeledContent("Seats", value: flow.selection.selectionSummary)
            }
            if flow.offersSeatDelivery {
                Section("Food and drink") {
                    Picker("Collection", selection: $flow.fulfilment) {
                        Text("Collect from the counter").tag(Fulfilment.collect)
                        Text("Deliver to my seat").tag(Fulfilment.seatDelivery)
                    }
                    .pickerStyle(.inline)
                    .labelsHidden()
                }
            }
            VoucherSection(flow: flow)
            PointsSection(flow: flow)
            if let q = flow.quote { Section("Price") { PriceBreakdown(quote: q, formatters: flow.formatters) } }
            Section {
                InfoBanner(.info, "Development build: payment is simulated and no money is taken. Apple Pay is enabled per operator once a payment provider is configured.")
                    .listRowBackground(Color.clear)
                #if DEBUG
                Toggle("Simulate a declined payment", isOn: $simulateDecline)
                #endif
            }
        }
        .scrollContentBackground(.hidden)
        .background(palette.background)
        .safeAreaInset(edge: .bottom) {
            Button {
                Task {
                    #if DEBUG
                    await flow.pay(simulateDecline: simulateDecline)
                    #else
                    await flow.pay()
                    #endif
                }
            } label: { Text("Pay \(flow.quote.map { flow.formatters.money($0.totalMinor) } ?? "")") }
                .buttonStyle(.cinemaPrimary)
                .disabled(flow.quote == nil)
                .bottomActionPadding()
        }
    }
}

struct VoucherSection: View {
    @Bindable var flow: BookingFlowModel
    @State private var code = ""
    @Environment(\.palette) private var palette

    var body: some View {
        Section {
            if let applied = flow.quote?.voucher {
                HStack {
                    Label("\(applied.code): \(applied.description)", systemImage: "tag.fill").foregroundStyle(palette.success)
                    Spacer()
                    Button("Remove") { Task { await flow.removeVoucher() } }
                }
            } else {
                HStack {
                    TextField("Voucher or promo code", text: $code)
                        .textInputAutocapitalization(.characters)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .onSubmit { Task { await flow.applyVoucher(code) } }
                    Button("Apply") { Task { await flow.applyVoucher(code) } }.disabled(code.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                if let message = flow.voucherMessage { Text(message).font(.footnote).foregroundStyle(palette.error) }
            }
        } header: { Text("Voucher") }
    }
}

/// Spend loyalty points in whole-pound steps. Hidden when the operator has no scheme
/// or the customer has no points yet; earning is still shown in the footer.
struct PointsSection: View {
    @Bindable var flow: BookingFlowModel
    @Environment(\.palette) private var palette

    var body: some View {
        if let loyalty = flow.quote?.loyalty {
            Section {
                if loyalty.redeemOptions.count > 1 {
                    Picker("Use points", selection: Binding(get: { flow.loyaltyPoints }, set: { v in Task { await flow.setLoyaltyPoints(v) } })) {
                        ForEach(loyalty.redeemOptions, id: \.self) { p in
                            Text(p == 0 ? "Don't use points" : "\(p) points (\(flow.formatters.money(-loyalty.valueMinor(of: p))))").tag(p)
                        }
                    }
                } else if loyalty.balance > 0 {
                    Text("You have \(loyalty.balance) points. You can use them from \(max(loyalty.redeemPointsPerPound, loyalty.minRedeemPoints)) points (\(flow.formatters.money(100)) off per \(loyalty.redeemPointsPerPound)).")
                        .font(.subheadline).foregroundStyle(palette.textSecondary)
                }
                if let message = flow.pointsMessage { Text(message).font(.footnote).foregroundStyle(palette.error) }
            } header: {
                Text(loyalty.name)
            } footer: {
                Text(loyalty.pointsToEarn > 0 ? "You'll earn \(loyalty.pointsToEarn) points with this booking. Balance: \(loyalty.balance) points." : "Balance: \(loyalty.balance) points.")
            }
        }
    }
}

// MARK: - Confirmation

struct ConfirmationScreen: View {
    let flow: BookingFlowModel
    let onViewTicket: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        ScrollView {
            if let b = flow.booking {
                VStack(spacing: Spacing.l) {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 64)).foregroundStyle(palette.success)
                        .symbolEffect(.bounce, options: .nonRepeating)
                        .accessibilityHidden(true)
                    Text("You're booked").font(.largeTitle.weight(.bold)).foregroundStyle(palette.textPrimary)
                    Text("\(b.film.title)\n\(flow.formatters.longDate(b.screening.startsAt, timeZone: b.venue.timeZone)) at \(flow.formatters.time(b.screening.startsAt, timeZone: b.venue.timeZone))")
                        .multilineTextAlignment(.center).foregroundStyle(palette.textSecondary)
                    if let admission = b.admission { QRCodeView(admission.barcode).frame(maxWidth: 220) }
                    Text("Reference \(b.reference) · Seats \(b.seatSummary)").font(.headline).foregroundStyle(palette.textPrimary)
                    if let earned = b.totals.pointsEarned, earned > 0 {
                        Label("You earned \(earned) points", systemImage: "star.circle.fill")
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(palette.success)
                    }
                    Button("View ticket", action: onViewTicket).buttonStyle(.cinemaPrimary)
                }
                .pagePadding()
                .padding(.vertical, Spacing.xl)
                .onAppear { AccessibilityNotification.Announcement("Booking confirmed. Reference \(b.reference).").post() }
            }
        }
        .background(palette.background)
    }
}
