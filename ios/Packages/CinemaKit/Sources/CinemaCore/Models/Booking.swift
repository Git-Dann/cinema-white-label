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
}

public struct Booking: Codable, Sendable, Hashable, Identifiable {
    public enum Status: String, Codable, Sendable { case PENDING_PAYMENT, CONFIRMED, CANCELLED, REFUNDED }
    public struct ScreeningInfo: Codable, Sendable, Hashable { public var id: String; public var startsAt: Date; public var endsAt: Date; public var localDate: String; public var formats: [String]; public var attributes: [String] }
    public struct FilmInfo: Codable, Sendable, Hashable { public var id: String; public var title: String; public var certificate: String; public var runtimeMinutes: Int; public var poster: ImageRef?; public var backdrop: ImageRef? }
    public struct VenueInfo: Codable, Sendable, Hashable { public var id: String; public var name: String; public var timeZone: String; public var address: Venue.Address; public var coordinate: Venue.Coordinate }
    public struct AuditoriumInfo: Codable, Sendable, Hashable { public var id: String; public var name: String; public var screenNumber: Int }
    public struct SeatInfo: Codable, Sendable, Hashable { public var seatId: String; public var rowLabel: String; public var seatLabel: String; public var ticketTypeId: String; public var priceMinor: Int }
    public struct Totals: Codable, Sendable, Hashable { public var currency: String; public var subtotalMinor: Int; public var feesMinor: Int; public var discountMinor: Int; public var totalMinor: Int }
    public struct PaymentInfo: Codable, Sendable, Hashable { public var provider: String; public var status: String; public var isSimulated: Bool }
    public struct Admission: Codable, Sendable, Hashable { public var barcode: String; public var format: String }
    public struct WalletInfo: Codable, Sendable, Hashable { public var available: Bool; public var status: String? }

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

    public var seatSummary: String { seats.map { "\($0.rowLabel)\($0.seatLabel)" }.joined(separator: ", ") }
    public func isUpcoming(now: Date) -> Bool { status == .CONFIRMED && screening.endsAt > now }
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
