import Foundation
import Observation

/// Drives the focused booking task: seats → tickets → review → payment → confirmation.
///
/// The server is authoritative for holds, prices and booking state. This model
/// keeps idempotency keys per attempt so retries after a timeout never create
/// a second hold or charge, and maps server error codes to recovery actions.
/// It is created once per flow and survives size changes (iPhone Duo).
@MainActor
@Observable
public final class BookingFlowModel {
    public enum Step: Hashable, Sendable { case seats, tickets, food, review, confirmed }

    public enum Phase: Equatable, Sendable {
        case idle
        case working(String)
        case failed(Failure)
    }

    public struct Failure: Equatable, Sendable {
        public enum Recovery: Equatable, Sendable { case chooseOtherSeats, startAgain, retry, dismiss }
        public let message: String
        public let recovery: Recovery
    }

    public let service: any CinemaService
    public let selection: SeatSelectionModel
    public let formatters: Formatters
    public private(set) var step: Step = .seats
    public private(set) var phase: Phase = .idle
    public private(set) var hold: SeatHold?
    public private(set) var holdWarnings: [RuleMessage] = []
    /// ticket type id per seat id.
    public private(set) var ticketTypes: [String: String] = [:]
    public private(set) var quote: Quote?
    public private(set) var booking: Booking?

    // Food and drink, voucher and fulfilment (server-priced via the quote).
    public private(set) var menu: ConcessionMenu?
    public private(set) var basket: [BasketItem] = []
    public private(set) var basketMessage: String?
    public private(set) var voucherCode: String?
    public private(set) var voucherMessage: String?
    public var fulfilment: Fulfilment = .collect {
        didSet { if fulfilment != oldValue { Task { await refreshQuote() } } }
    }
    /// True when this cinema sells food and drink through the app.
    public var offersFood: Bool { menu.map { $0.features.concessions && !$0.isEmpty } ?? false }
    public var offersSeatDelivery: Bool { (menu?.features.seatDelivery ?? false) && !basket.isEmpty }
    public var extras: BasketExtras {
        BasketExtras(concessions: basket, voucherCode: voucherCode, fulfilment: offersSeatDelivery ? fulfilment : .collect)
    }
    /// serverTime - deviceTime when the hold was created; corrects device clock drift.
    private var serverClockOffset: TimeInterval = 0
    private var holdKey = UUID().uuidString
    /// Seat set the current hold idempotency key belongs to. A retry for the
    /// same seats reuses the key (so a timed-out request can't create two holds).
    private var holdKeySignature = ""
    private var heldSeatSignature = ""
    private var checkoutKey = UUID().uuidString
    private let analytics: AnalyticsRecorder?

    public init(service: any CinemaService, selection: SeatSelectionModel, formatters: Formatters, analytics: AnalyticsRecorder? = nil) {
        self.service = service
        self.selection = selection
        self.formatters = formatters
        self.analytics = analytics
    }

    public var screening: ScreeningDetail { selection.screening }
    public var pricing: Pricing { screening.pricing }

    // MARK: Hold timing

    /// Seconds until the hold expires, using the server's clock.
    public func secondsRemaining(now: Date = Date()) -> Int? {
        guard let hold, hold.status == .ACTIVE else { return nil }
        return Int((hold.expiresAt.timeIntervalSince(now.addingTimeInterval(serverClockOffset))).rounded(.down))
    }

    public func isHoldExpired(now: Date = Date()) -> Bool { (secondsRemaining(now: now) ?? 1) <= 0 && hold != nil }

    // MARK: Step 1 → 2: reserve seats

    /// Creates (or replaces) the server hold for the current selection.
    public func reserveSeats() async {
        guard selection.canContinue else { return }
        let seatIds = selection.selectedSeatIds
        let signature = seatIds.sorted().joined(separator: ",")
        if let hold, hold.status == .ACTIVE, signature == heldSeatSignature, !isHoldExpired() {
            step = .tickets
            return
        }
        if signature != holdKeySignature {
            holdKey = UUID().uuidString
            holdKeySignature = signature
        }
        phase = .working("Reserving your seats…")
        do {
            let h = try await service.createHold(screeningId: screening.id, seatIds: seatIds, idempotencyKey: holdKey)
            hold = h
            holdWarnings = h.warnings
            heldSeatSignature = signature
            serverClockOffset = h.serverTime.timeIntervalSince(Date())
            let defaultType = pricing.defaultTicketType?.id
            ticketTypes = Dictionary(uniqueKeysWithValues: seatIds.map { ($0, ticketTypes[$0] ?? defaultType ?? "") })
            phase = .idle
            step = .tickets
            await refreshQuote()
            if menu == nil { menu = try? await service.concessions(venueId: screening.venue.id) }
        } catch let e as APIError {
            await analytics?.record(.seatHoldFailed, ["code": e.rawCode, "screeningId": screening.id])
            switch e.code {
            case .seatsUnavailable:
                selection.markConflicts(e.seatIds)
                phase = .failed(Failure(message: selection.message?.text ?? e.message, recovery: .chooseOtherSeats))
            case .seatRules:
                phase = .failed(Failure(message: e.violations.first?.message ?? e.message, recovery: .chooseOtherSeats))
            case .screeningClosed:
                phase = .failed(Failure(message: "This screening is no longer on sale.", recovery: .dismiss))
            default:
                phase = .failed(Failure(message: e.message, recovery: .retry))
            }
        } catch {
            phase = .failed(Failure(message: "Something went wrong. Please try again.", recovery: .retry))
        }
    }

    // MARK: Step 2: ticket types

    public func ticketTypeOptions(for seat: Seat) -> [Pricing.TicketType] {
        pricing.ticketTypes.filter { pricing.price(for: $0, category: seat.priceCategory) != nil }
    }

    public func setTicketType(_ typeId: String, for seatId: String) async {
        ticketTypes[seatId] = typeId
        Task { await analytics?.record(.ticketTypeChanged, ["screeningId": screening.id, "ticketType": pricing.ticketTypes.first { $0.id == typeId }?.code ?? typeId]) }
        await refreshQuote()
    }

    public var tickets: [TicketSelection] {
        selection.selectedSeatIds.map { TicketSelection(seatId: $0, ticketTypeId: ticketTypes[$0] ?? "") }
    }

    public func refreshQuote() async {
        guard let hold else { return }
        do {
            quote = try await service.quote(holdId: hold.id, tickets: tickets, extras: extras)
            basketMessage = nil
            checkoutKey = UUID().uuidString // price may have changed; new attempt
        } catch let e as APIError {
            switch e.rawCode {
            case "voucher_invalid":
                voucherMessage = e.message
                voucherCode = nil
                await refreshQuote()
            case "concession_unavailable", "validation_failed" where step == .food:
                basketMessage = e.message
            default:
                handleHoldError(e)
            }
        } catch {}
    }

    /// After tickets: food step if this cinema offers it, otherwise review.
    public func continueToReview() {
        guard quote != nil else { return }
        if step == .tickets && offersFood {
            step = .food
            return
        }
        step = .review
        Task { await analytics?.record(.checkoutStarted, ["screeningId": screening.id]) }
    }

    // MARK: Food and drink

    public func addToBasket(_ item: BasketItem) async {
        if let i = basket.firstIndex(where: { $0.productId == item.productId && $0.modifiers == item.modifiers }) {
            basket[i].quantity += item.quantity
        } else {
            basket.append(item)
        }
        Task { await analytics?.record(.foodAdded, ["productId": item.productId, "quantity": String(item.quantity)]) }
        await refreshQuote()
    }

    public func setQuantity(_ quantity: Int, for itemId: String) async {
        guard let i = basket.firstIndex(where: { $0.id == itemId }) else { return }
        if quantity <= 0 {
            let removed = basket.remove(at: i)
            Task { await analytics?.record(.foodRemoved, ["productId": removed.productId]) }
        } else {
            basket[i].quantity = min(quantity, 20)
        }
        await refreshQuote()
    }

    public func product(for item: BasketItem) -> ConcessionProduct? {
        menu?.categories.flatMap(\.items).first { $0.id == item.productId }
    }

    // MARK: Vouchers

    public func applyVoucher(_ code: String) async {
        let trimmed = code.trimmingCharacters(in: .whitespacesAndNewlines)
        voucherMessage = nil
        voucherCode = trimmed.isEmpty ? nil : trimmed
        await refreshQuote()
        Task { await analytics?.record(.voucherApplied, ["result": voucherCode == nil ? "rejected" : "accepted"]) }
    }

    public func removeVoucher() async {
        voucherCode = nil
        voucherMessage = nil
        await refreshQuote()
    }

    // MARK: Step 3: pay

    public func pay(simulateDecline: Bool = false) async {
        guard let hold else { return }
        if isHoldExpired() {
            phase = .failed(Failure(message: "Your seat reservation has expired. Please choose your seats again.", recovery: .startAgain))
            return
        }
        phase = .working("Confirming your booking…")
        do {
            let b = try await service.checkout(holdId: hold.id, tickets: tickets, extras: extras, simulateDecline: simulateDecline, idempotencyKey: checkoutKey)
            booking = b
            phase = .idle
            step = .confirmed
            await analytics?.record(.paymentCompleted, ["screeningId": screening.id])
            await analytics?.record(.bookingConfirmed, ["screeningId": screening.id, "seats": String(b.seats.count), "foodItems": String(basket.reduce(0) { $0 + $1.quantity })])
        } catch let e as APIError {
            await analytics?.record(.checkoutFailed, ["screeningId": screening.id, "code": e.rawCode])
            if e.code == .paymentDeclined {
                checkoutKey = UUID().uuidString // a new attempt after a decline
                phase = .failed(Failure(message: "Your payment was declined. No booking was made and your seats are still reserved.", recovery: .retry))
            } else {
                handleHoldError(e)
            }
        } catch {
            // Unknown outcome (e.g. timeout): retrying with the same key is safe.
            phase = .failed(Failure(message: "We couldn't confirm your booking. Try again; you won't be charged twice.", recovery: .retry))
        }
    }

    private func handleHoldError(_ e: APIError) {
        switch e.code {
        case .holdExpired, .holdNotActive:
            hold = nil
            heldSeatSignature = ""
            phase = .failed(Failure(message: "Your seat reservation has expired. Please choose your seats again.", recovery: .startAgain))
        case .seatsUnavailable:
            selection.markConflicts(e.seatIds)
            hold = nil
            heldSeatSignature = ""
            phase = .failed(Failure(message: "Some of your seats are no longer available.", recovery: .chooseOtherSeats))
        case .network:
            phase = .failed(Failure(message: e.message, recovery: .retry))
        default:
            phase = .failed(Failure(message: e.message, recovery: .retry))
        }
    }

    // MARK: Navigation and recovery

    public func dismissFailure() { phase = .idle }

    /// Applies a failure's recovery action.
    public func recover() async {
        guard case let .failed(f) = phase else { return }
        phase = .idle
        switch f.recovery {
        case .chooseOtherSeats, .startAgain:
            step = .seats
            if let snapshot = try? await service.availability(screeningId: screening.id) {
                selection.apply(snapshot: snapshot, ownHoldSeatIds: Set(hold?.seatIds ?? []))
            }
        case .retry, .dismiss:
            break
        }
    }

    public func goBack() {
        switch step {
        case .tickets: step = .seats
        case .food: step = .tickets
        case .review: step = offersFood ? .food : .tickets
        case .seats, .confirmed: break
        }
    }

    /// Releases the hold when the customer abandons the flow.
    public func abandon() async {
        guard step != .confirmed else { return }
        await analytics?.record(.bookingAbandoned, ["screeningId": screening.id, "step": "\(step)"])
        if let hold, hold.status == .ACTIVE { try? await service.releaseHold(id: hold.id) }
        hold = nil
    }

    /// Seat ids currently protected by our own hold (not conflicts).
    public var ownHoldSeatIds: Set<String> { Set(hold?.seatIds ?? []) }
}
