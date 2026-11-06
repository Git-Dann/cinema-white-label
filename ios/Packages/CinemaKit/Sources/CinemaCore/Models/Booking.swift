import Foundation

public struct RuleMessage: Codable, Sendable, Hashable {
    public var code: String
    public var message: String
    public var seatIds: [String]
}

public struct SeatHold: Codable, Sendable, Hashable, Identifiable {
    public enum Status: String, Codable, Sendable { case ACTIVE, CONVERTED, RELEASED, EXPIRED }
    public var id: String
    public var screeningId: String
    public var seatIds: [String]
    public var status: Status
    public var expiresAt: Date
    public var serverTime: Date
    public var warnings: [RuleMessage]
}

public struct TicketSelection: Codable, Sendable, Hashable {
    public var seatId: String
    public var ticketTypeId: String
    public init(seatId: String, ticketTypeId: String) { self.seatId = seatId; self.ticketTypeId = ticketTypeId }
}

public struct Quote: Codable, Sendable, Hashable {
    public struct Line: Codable, Sendable, Hashable {
        public var seatId: String
        public var rowLabel: String
        public var seatLabel: String
        public var ticketTypeId: String
        public var ticketTypeName: String
        public var priceCategory: String
        public var baseMinor: Int
        public var supplementsMinor: Int
        public var priceMinor: Int
    }
    public var currency: String
    public var lines: [Line]
    public var subtotalMinor: Int
    public var feesMinor: Int
    public var discountMinor: Int
    public var totalMinor: Int
    public var feeLabel: String?
    public var concessions: [ConcessionLine]? = nil
    public var concessionsMinor: Int? = nil
    public var voucher: AppliedVoucher? = nil
    public var fulfilment: Fulfilment? = nil
    /// Every discount applied, in the order the server applied them (membership, voucher, points).
    public var discounts: [Discount]? = nil
    public var membership: MembershipBenefit? = nil
    public var loyalty: LoyaltyQuote? = nil

    public struct AppliedVoucher: Codable, Sendable, Hashable { public var code: String; public var description: String; public var discountMinor: Int }
    public struct Discount: Codable, Sendable, Hashable {
        /// "membership" | "voucher" | "points"
        public var kind: String
        public var label: String
        public var amountMinor: Int
        public init(kind: String, label: String, amountMinor: Int) { self.kind = kind; self.label = label; self.amountMinor = amountMinor }
    }
    public struct MembershipBenefit: Codable, Sendable, Hashable {
        public var planName: String
        public var discountMinor: Int
        public var feeWaivedMinor: Int
        public init(planName: String, discountMinor: Int, feeWaivedMinor: Int) { self.planName = planName; self.discountMinor = discountMinor; self.feeWaivedMinor = feeWaivedMinor }
    }
    public struct LoyaltyQuote: Codable, Sendable, Hashable {
        public var name: String
        public var earnPointsPerPound: Int
        public var redeemPointsPerPound: Int
        public var minRedeemPoints: Int
        public var balance: Int
        public var pointsRedeemed: Int
        public var pointsDiscountMinor: Int
        public var pointsToEarn: Int
        public var maxRedeemablePoints: Int

        public init(name: String, earnPointsPerPound: Int, redeemPointsPerPound: Int, minRedeemPoints: Int, balance: Int, pointsRedeemed: Int, pointsDiscountMinor: Int, pointsToEarn: Int, maxRedeemablePoints: Int) {
            self.name = name; self.earnPointsPerPound = earnPointsPerPound; self.redeemPointsPerPound = redeemPointsPerPound; self.minRedeemPoints = minRedeemPoints
            self.balance = balance; self.pointsRedeemed = pointsRedeemed; self.pointsDiscountMinor = pointsDiscountMinor; self.pointsToEarn = pointsToEarn; self.maxRedeemablePoints = maxRedeemablePoints
        }

        /// The amounts a customer can choose: nothing, then each whole pound up to the maximum.
        public var redeemOptions: [Int] {
            guard maxRedeemablePoints > 0, redeemPointsPerPound > 0 else { return [0] }
            let first = max(redeemPointsPerPound, Int((Double(minRedeemPoints) / Double(redeemPointsPerPound)).rounded(.up)) * redeemPointsPerPound)
            guard first <= maxRedeemablePoints else { return [0] }
            return [0] + Array(stride(from: first, through: maxRedeemablePoints, by: redeemPointsPerPound))
        }

        /// Value of a number of points off this order, in minor units.
        public func valueMinor(of points: Int) -> Int { redeemPointsPerPound > 0 ? points / redeemPointsPerPound * 100 : 0 }
    }
}

public enum Fulfilment: String, Codable, Sendable, Hashable { case collect, seatDelivery }

public struct ConcessionLine: Codable, Sendable, Hashable {
    public struct Modifier: Codable, Sendable, Hashable { public var groupId: String; public var optionIds: [String]; public var label: String; public var priceMinor: Int }
    public var productId: String
    public var name: String
    public var quantity: Int
    public var unitPriceMinor: Int
    public var modifiers: [Modifier]
    public var lineTotalMinor: Int
}

public struct Booking: Codable, Sendable, Hashable, Identifiable {
    public enum Status: String, Codable, Sendable { case PENDING_PAYMENT, CONFIRMED, CANCELLED, REFUNDED }
    public struct ScreeningInfo: Codable, Sendable, Hashable { public var id: String; public var startsAt: Date; public var endsAt: Date; public var localDate: String; public var formats: [String]; public var attributes: [String] }
    public struct FilmInfo: Codable, Sendable, Hashable { public var id: String; public var title: String; public var certificate: String; public var runtimeMinutes: Int; public var poster: ImageRef?; public var backdrop: ImageRef? }
    public struct VenueInfo: Codable, Sendable, Hashable { public var id: String; public var name: String; public var timeZone: String; public var address: Venue.Address; public var coordinate: Venue.Coordinate }
    public struct AuditoriumInfo: Codable, Sendable, Hashable { public var id: String; public var name: String; public var screenNumber: Int }
    public struct SeatInfo: Codable, Sendable, Hashable { public var seatId: String; public var rowLabel: String; public var seatLabel: String; public var ticketTypeId: String; public var priceMinor: Int }
    public struct Totals: Codable, Sendable, Hashable {
        public var currency: String; public var subtotalMinor: Int; public var feesMinor: Int; public var discountMinor: Int; public var totalMinor: Int
        public var concessionsMinor: Int?; public var voucherCode: String?
        public var membershipDiscountMinor: Int? = nil; public var membershipPlanName: String? = nil
        public var pointsRedeemed: Int? = nil; public var pointsDiscountMinor: Int? = nil; public var pointsEarned: Int? = nil
    }
    public struct FoodItem: Codable, Sendable, Hashable { public var name: String; public var quantity: Int; public var modifiers: [String]; public var lineTotalMinor: Int }
    public struct Cancellation: Codable, Sendable, Hashable { public var cancelledAt: Date?; public var cancellableUntil: Date; public var canCancel: Bool; public var refundedMinor: Int }
    public struct PaymentInfo: Codable, Sendable, Hashable { public var provider: String; public var status: String; public var isSimulated: Bool }
    public struct Admission: Codable, Sendable, Hashable { public var barcode: String; public var format: String }
    public struct WalletInfo: Codable, Sendable, Hashable { public var available: Bool; public var status: String? }
    /// Whether food and drink can still be pre-ordered for this booking.
    public struct Preorder: Codable, Sendable, Hashable { public var open: Bool; public var closesAt: Date
        public init(open: Bool, closesAt: Date) { self.open = open; self.closesAt = closesAt } }

    public var id: String
    public var reference: String
    public var status: Status
    public var createdAt: Date
    public var confirmedAt: Date?
    public var screening: ScreeningInfo
    public var film: FilmInfo
    public var venue: VenueInfo
    public var auditorium: AuditoriumInfo
    public var seats: [SeatInfo]
    public var totals: Totals
    public var payment: PaymentInfo?
    public var admission: Admission?
    public var wallet: WalletInfo
    public var concessions: [FoodItem]?
    public var fulfilment: Fulfilment?
    public var cancellation: Cancellation?
    public var preorder: Preorder? = nil

    public var seatSummary: String { seats.map { "\($0.rowLabel)\($0.seatLabel)" }.joined(separator: ", ") }
    public func isUpcoming(now: Date) -> Bool { status == .CONFIRMED && screening.endsAt > now }
    /// Food can be added now: confirmed, before the server's cutoff, at a cinema that sells food.
    public func canPreorder(now: Date) -> Bool {
        guard status == .CONFIRMED, let p = preorder, p.open else { return false }
        return p.closesAt > now
    }
}

/// Server price for a food pre-order on an existing booking (POST bookings/{id}/concessions/quote).
public struct FoodPreorderQuote: Codable, Sendable, Hashable {
    public var bookingId: String
    public var concessions: [ConcessionLine]
    public var subtotalMinor: Int
    public var discounts: [Quote.Discount]
    public var discountMinor: Int
    public var totalMinor: Int
    public var currency: String
    public var fulfilment: Fulfilment
    public var pointsToEarn: Int
    public var collectBy: Date

    public init(bookingId: String, concessions: [ConcessionLine], subtotalMinor: Int, discounts: [Quote.Discount], discountMinor: Int, totalMinor: Int, currency: String, fulfilment: Fulfilment, pointsToEarn: Int, collectBy: Date) {
        self.bookingId = bookingId; self.concessions = concessions; self.subtotalMinor = subtotalMinor; self.discounts = discounts; self.discountMinor = discountMinor
        self.totalMinor = totalMinor; self.currency = currency; self.fulfilment = fulfilment; self.pointsToEarn = pointsToEarn; self.collectBy = collectBy
    }
}

/// Result of requesting an Apple Wallet pass for a booking.
public enum WalletPassResponse: Decodable, Sendable, Hashable {
    /// A signed .pkpass from an authorised issuer.
    case issued(serialNumber: String, pkpass: Data)
    /// Development state: no signing certificate is configured. Never presented as a real pass.
    case demoUnsigned(serialNumber: String, message: String)

    private enum CodingKeys: String, CodingKey { case status, serialNumber, pkpassBase64, message }
    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let status = try c.decode(String.self, forKey: .status)
        let serial = try c.decode(String.self, forKey: .serialNumber)
        switch status {
        case "issued":
            let b64 = try c.decode(String.self, forKey: .pkpassBase64)
            guard let data = Data(base64Encoded: b64) else {
                throw DecodingError.dataCorruptedError(forKey: .pkpassBase64, in: c, debugDescription: "Invalid pass data")
            }
            self = .issued(serialNumber: serial, pkpass: data)
        default:
            self = .demoUnsigned(serialNumber: serial, message: try c.decode(String.self, forKey: .message))
        }
    }
}

public struct GuestSession: Codable, Sendable, Hashable {
    public var token: String
    public var customerId: String
    public var kind: String
}
