import SwiftUI
import PassKit
import EventKitUI
import CinemaCore
import CinemaDesign

/// Tickets: upcoming and past bookings, available offline from the local cache.
struct TicketsView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette

    var body: some View {
        let upcoming = app.tickets.upcoming()
        let past = app.tickets.past()
        List {
            if app.tickets.isOffline {
                InfoBanner(.info, "You're offline. Showing tickets saved on this device.")
                    .listRowBackground(Color.clear)
            } else if let problem = app.tickets.refreshProblem {
                InfoBanner(.warning, "We couldn't update your tickets (\(problem)). Showing tickets saved on this device.", actionTitle: "Try again") {
                    Task { await app.refreshTickets() }
                }
                .listRowBackground(Color.clear)
            }
            if upcoming.isEmpty && past.isEmpty {
                ContentUnavailableView("No tickets yet", systemImage: "ticket", description: Text("Tickets you book appear here, and stay available without a connection."))
                    .listRowBackground(Color.clear)
            }
            if !upcoming.isEmpty {
                Section("Upcoming") { ForEach(upcoming) { b in NavigationLink { TicketDetailView(booking: b) } label: { TicketRow(booking: b) } } }
            }
            if !past.isEmpty {
                Section("Past") { ForEach(past) { b in NavigationLink { TicketDetailView(booking: b) } label: { TicketRow(booking: b) } } }
            }
        }
        .scrollContentBackground(.hidden)
        .background(palette.background)
        .navigationTitle("Tickets")
        .refreshable { await app.refreshTickets() }
        .task { await app.refreshTickets() }
    }
}

struct TicketRow: View {
    let booking: Booking
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: Spacing.s) {
            ArtworkImage(booking.film.poster, fallbackTitle: booking.film.title).frame(width: 54, height: 81).clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.small, style: .continuous))
            VStack(alignment: .leading, spacing: Spacing.xxs) {
                Text(booking.film.title).font(.headline).foregroundStyle(palette.textPrimary)
                Text("\(app.formatters.shortDate(booking.screening.startsAt, timeZone: booking.venue.timeZone)) · \(app.formatters.time(booking.screening.startsAt, timeZone: booking.venue.timeZone))")
                    .font(.subheadline).foregroundStyle(palette.textSecondary)
                Text("\(booking.venue.name) · Seats \(booking.seatSummary)").font(.footnote).foregroundStyle(palette.textMuted).lineLimit(1)
                if booking.status != .CONFIRMED { Text(booking.status == .CANCELLED ? "Cancelled" : "Refunded").font(.footnote.weight(.semibold)).foregroundStyle(palette.error) }
            }
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// Ticket with admission QR code, Wallet action and calendar.
struct TicketDetailView: View {
    let booking: Booking
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @State private var wallet: WalletState = .idle
    @State private var showingCalendar = false
    @State private var confirmingCancel = false
    @State private var cancelError: String?
    @State private var current: Booking?
    private var shown: Booking { current ?? booking }

    enum WalletState: Equatable { case idle, requesting, demo(String), ready(Data), failed(String) }

    var body: some View {
        ScrollView {
            VStack(spacing: Spacing.l) {
                VStack(spacing: Spacing.xs) {
                    Text(booking.film.title).font(.title.weight(.bold)).foregroundStyle(palette.textPrimary).multilineTextAlignment(.center)
                    Text(app.formatters.longDate(booking.screening.startsAt, timeZone: booking.venue.timeZone) + " at " + app.formatters.time(booking.screening.startsAt, timeZone: booking.venue.timeZone))
                        .foregroundStyle(palette.textSecondary)
                }
                if let admission = booking.admission, booking.status == .CONFIRMED {
                    QRCodeView(admission.barcode).frame(maxWidth: 260)
                    Text("Booking reference \(booking.reference)").font(.headline.monospaced()).foregroundStyle(palette.textPrimary)
                        .accessibilityLabel("Booking reference \(booking.reference.map(String.init).joined(separator: " "))")
                }
                details
                if let food = booking.concessions, !food.isEmpty { foodSection(food) }
                if app.config.features.concessions, booking.canPreorder(now: Date()) {
                    Button {
                        app.selectedVenueID = booking.venue.id
                        AppNavigator.shared.requested = .food
                    } label: {
                        Label(booking.concessions?.isEmpty == false ? "Add more food and drink" : "Pre-order food and drink", systemImage: "popcorn.fill")
                    }
                    .buttonStyle(.cinemaGlass)
                    .accessibilityHint("Opens the menu for this booking")
                }
                walletSection
                Button { showingCalendar = true } label: { Label("Add to Calendar", systemImage: "calendar.badge.plus") }
                    .buttonStyle(.cinemaGlass)
                cancelSection
                if booking.payment?.isSimulated == true {
                    InfoBanner(.info, "Development booking: paid with a simulated payment. No money was taken.")
                }
            }
            .pagePadding()
            .padding(.top, Spacing.m)
            .padding(.bottom, Spacing.section)
        }
        .background(palette.background)
        .navigationTitle("Ticket")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showingCalendar) {
            CalendarEventSheet(booking: booking, formatters: app.formatters).ignoresSafeArea()
        }
    }

    private func foodSection(_ food: [Booking.FoodItem]) -> some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Label(booking.fulfilment == .seatDelivery ? "Food delivered to your seat" : "Collect food at the counter", systemImage: "takeoutbag.and.cup.and.straw.fill")
                .font(.headline).foregroundStyle(palette.textPrimary)
            ForEach(food, id: \.self) { f in
                HStack {
                    Text("\(f.quantity) × \(f.name)" + (f.modifiers.isEmpty ? "" : " (\(f.modifiers.joined(separator: ", ")))")).foregroundStyle(palette.textSecondary)
                    Spacer()
                    Text(app.formatters.money(f.lineTotalMinor)).monospacedDigit().foregroundStyle(palette.textPrimary)
                }
                .accessibilityElement(children: .combine)
            }
        }
        .cardStyle()
    }

    @ViewBuilder
    private var cancelSection: some View {
        if let c = shown.cancellation {
            if shown.status == .REFUNDED {
                InfoBanner(.success, "Cancelled. \(app.formatters.money(c.refundedMinor)) refunded to your original payment method.")
            } else if c.canCancel {
                Button(role: .destructive) { confirmingCancel = true } label: { Label("Cancel booking", systemImage: "xmark.circle") }
                    .buttonStyle(.cinemaGlass)
                    .confirmationDialog("Cancel this booking?", isPresented: $confirmingCancel, titleVisibility: .visible) {
                        Button("Cancel booking and refund \(app.formatters.money(shown.totals.totalMinor))", role: .destructive) { Task { await cancel() } }
                        Button("Keep booking", role: .cancel) {}
                    } message: {
                        Text("Your seats will be released and the full amount refunded.")
                    }
                Text("You can cancel until \(app.formatters.time(c.cancellableUntil, timeZone: booking.venue.timeZone)) on \(app.formatters.shortDate(c.cancellableUntil, timeZone: booking.venue.timeZone)).")
                    .font(.footnote).foregroundStyle(palette.textMuted)
            }
            if let cancelError { InfoBanner(.error, cancelError) }
        }
    }

    private func cancel() async {
        do {
            try await app.tickets.cancel(booking, using: app.service)
            current = app.tickets.bookings.first { $0.id == booking.id }
            await app.analytics.record(.bookingCancelled, ["bookingId": booking.id])
            AccessibilityNotification.Announcement("Booking cancelled and refunded").post()
        } catch {
            cancelError = (error as? APIError)?.message ?? "Couldn't cancel this booking."
        }
    }

    private var details: some View {
        VStack(spacing: 0) {
            row("Cinema", booking.venue.name)
            Divider().overlay(palette.divider)
            row("Screen", booking.auditorium.name)
            Divider().overlay(palette.divider)
            row("Seats", booking.seatSummary)
            Divider().overlay(palette.divider)
            row("Total", app.formatters.money(booking.totals.totalMinor))
        }
        .cardStyle(padding: 0)
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(palette.textMuted)
            Spacer()
            Text(value).foregroundStyle(palette.textPrimary).multilineTextAlignment(.trailing)
        }
        .padding(.horizontal, Spacing.card).padding(.vertical, Spacing.s)
        .frame(minHeight: Spacing.tap)
        .accessibilityElement(children: .combine)
    }

    /// Wallet integration boundary. A real "Add to Apple Wallet" button appears only
    /// when the backend returns a signed pass; otherwise the demo state is explained.
    @ViewBuilder
    private var walletSection: some View {
        if app.config.features.wallet, booking.status == .CONFIRMED {
            switch wallet {
            case .idle, .requesting:
                Button { Task { await requestPass() } } label: {
                    Label(wallet == .requesting ? "Preparing pass…" : "Get Apple Wallet pass", systemImage: "wallet.pass")
                }
                .buttonStyle(.cinemaGlass)
                .disabled(wallet == .requesting || !PKAddPassesViewController.canAddPasses())
            case .ready(let data):
                AddToWalletButton(data: data).frame(height: 50)
            case .demo(let message):
                InfoBanner(.info, message)
            case .failed(let message):
                InfoBanner(.error, message, actionTitle: "Try again") { wallet = .idle }
            }
        }
    }

    private func requestPass() async {
        wallet = .requesting
        await app.analytics.record(.walletPassRequested, ["bookingId": booking.id])
        do {
            switch try await app.service.requestWalletPass(bookingId: booking.id) {
            case .issued(_, let data):
                wallet = .ready(data)
                await app.analytics.record(.walletPassIssued, ["bookingId": booking.id])
            case .demoUnsigned(_, let message):
                wallet = .demo(message)
            }
        } catch {
            wallet = .failed((error as? APIError)?.message ?? "Couldn't prepare your Wallet pass.")
        }
    }
}

/// Apple's standard Add to Apple Wallet button for a signed pass.
struct AddToWalletButton: View {
    let data: Data
    @State private var pass: PKPass?
    @State private var presenting = false

    var body: some View {
        Group {
            if let pass {
                AddPassToWalletButton([pass]) { _ in }
            } else {
                Text("This pass couldn't be read.").font(.footnote)
            }
        }
        .onAppear { pass = try? PKPass(data: data) }
    }
}

/// Presents the system event editor so the customer reviews the event; uses
/// write-only access rather than asking for the whole calendar.
struct CalendarEventSheet: UIViewControllerRepresentable {
    let booking: Booking
    let formatters: Formatters

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let store = EKEventStore()
        let event = EKEvent(eventStore: store)
        event.title = booking.film.title
        event.startDate = booking.screening.startsAt
        event.endDate = booking.screening.endsAt
        event.location = "\(booking.venue.name), \(booking.venue.address.line1), \(booking.venue.address.city) \(booking.venue.address.postcode)"
        event.notes = "\(booking.auditorium.name) · Seats \(booking.seatSummary) · Ref \(booking.reference)"
        let vc = EKEventEditViewController()
        vc.eventStore = store
        vc.event = event
        vc.editViewDelegate = context.coordinator
        return vc
    }

    func updateUIViewController(_ uiViewController: EKEventEditViewController, context: Context) {}

    final class Coordinator: NSObject, EKEventEditViewDelegate {
        func eventEditViewController(_ controller: EKEventEditViewController, didCompleteWith action: EKEventEditViewAction) {
            controller.dismiss(animated: true)
        }
    }
}
