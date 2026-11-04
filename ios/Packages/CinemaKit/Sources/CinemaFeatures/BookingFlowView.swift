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
                if flow.step == .tickets || flow.step == .review {
                    ToolbarItem(placement: .principal) { HoldCountdown(flow: flow) }
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
        case .review: ReviewScreen(flow: flow)
        case .confirmed: ConfirmationScreen(flow: flow) { if let b = flow.booking { onFinish(.confirmed(b)) } }
        }
    }

    private var title: String {
        switch flow.step { case .seats: "Choose Seats"; case .tickets: "Tickets"; case .review: "Review"; case .confirmed: "Booked" }
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
                Label(s > 0 ? flow.formatters.countdown(s) : "Expired", systemImage: "timer")
                    .font(.subheadline.monospacedDigit().weight(.semibold))
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
                ScrollView { summary.padding(20) }
                    .frame(width: 340)
                    .background(palette.backgroundElevated)
            }
            .frame(minWidth: 720)
            VStack(spacing: 0) { mapArea }
                .safeAreaInset(edge: .bottom) {
                    summary
                        .padding(16)
                        .glassEffect(.regular, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
                        .padding(.horizontal, 10)
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
            if mode == .map {
                SeatMapContainer(model: selection, formatters: flow.formatters) { seat, result in
                    if case .selected = result { Task { await app.analytics.record(.seatSelected, ["screeningId": flow.screening.id]) } }
                }
                SeatLegend(layout: selection.layout).padding(.vertical, 10)
            } else {
                SeatListView(model: selection, formatters: flow.formatters)
            }
        }
    }

    private var header: some View {
        let s = flow.screening
        return VStack(spacing: 2) {
            Text(s.film.title).font(.headline).foregroundStyle(palette.textPrimary)
            Text("\(flow.formatters.shortDate(s.startsAt, timeZone: s.venue.timeZone)) · \(flow.formatters.time(s.startsAt, timeZone: s.venue.timeZone)) · \(s.auditorium.name) · \(s.formats.joined(separator: " "))")
                .font(.subheadline).foregroundStyle(palette.textMuted)
        }
        .padding(.vertical, 8)
        .accessibilityElement(children: .combine)
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 12) {
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
            isPolling = true
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
                            Text(SeatAccessibility.categoryName(SeatPresentation.Category(rawValue: seat.type.rawValue) ?? .standard).capitalized)
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
                .padding(16)
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
        if quote.feesMinor > 0 { line(quote.feeLabel ?? "Fees", quote.feesMinor) }
        if quote.discountMinor > 0 { line("Discount", -quote.discountMinor) }
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
                .padding(16)
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
                VStack(spacing: 20) {
                    Image(systemName: "checkmark.circle.fill").font(.system(size: 64)).foregroundStyle(palette.success)
                        .symbolEffect(.bounce, options: .nonRepeating)
                        .accessibilityHidden(true)
                    Text("You're booked").font(.largeTitle.weight(.bold)).foregroundStyle(palette.textPrimary)
                    Text("\(b.film.title)\n\(flow.formatters.longDate(b.screening.startsAt, timeZone: b.venue.timeZone)) at \(flow.formatters.time(b.screening.startsAt, timeZone: b.venue.timeZone))")
                        .multilineTextAlignment(.center).foregroundStyle(palette.textSecondary)
                    if let admission = b.admission { QRCodeView(admission.barcode).frame(maxWidth: 220) }
                    Text("Reference \(b.reference) · Seats \(b.seatSummary)").font(.headline).foregroundStyle(palette.textPrimary)
                    Button("View ticket", action: onViewTicket).buttonStyle(.cinemaPrimary)
                }
                .padding(24)
                .onAppear { AccessibilityNotification.Announcement("Booking confirmed. Reference \(b.reference).").post() }
            }
        }
        .background(palette.background)
    }
}
