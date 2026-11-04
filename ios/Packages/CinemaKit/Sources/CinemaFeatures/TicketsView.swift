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
        .refreshable { await app.tickets.refresh(using: app.service) }
        .task { await app.tickets.refresh(using: app.service) }
    }
}

struct TicketRow: View {
    let booking: Booking
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 12) {
            ArtworkImage(booking.film.poster).frame(width: 54, height: 81).clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            VStack(alignment: .leading, spacing: 3) {
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

    enum WalletState: Equatable { case idle, requesting, demo(String), ready(Data), failed(String) }

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                VStack(spacing: 6) {
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
                walletSection
                Button { showingCalendar = true } label: { Label("Add to Calendar", systemImage: "calendar.badge.plus") }
                    .buttonStyle(.cinemaGlass)
                if booking.payment?.isSimulated == true {
                    InfoBanner(.info, "Development booking: paid with a simulated payment. No money was taken.")
                }
            }
            .padding(20)
        }
        .background(palette.background)
        .navigationTitle("Ticket")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $showingCalendar) {
            CalendarEventSheet(booking: booking, formatters: app.formatters).ignoresSafeArea()
        }
    }

    private var details: some View {
        VStack(spacing: 0) {
            row("Cinema", booking.venue.name)
            row("Screen", booking.auditorium.name)
            row("Seats", booking.seatSummary)
            row("Total", app.formatters.money(booking.totals.totalMinor))
        }
        .background(palette.surface, in: RoundedRectangle(cornerRadius: palette.cornerRadius.medium, style: .continuous))
    }

    private func row(_ label: String, _ value: String) -> some View {
        HStack {
            Text(label).foregroundStyle(palette.textMuted)
            Spacer()
            Text(value).foregroundStyle(palette.textPrimary).multilineTextAlignment(.trailing)
        }
        .padding(.horizontal, 16).padding(.vertical, 12)
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
