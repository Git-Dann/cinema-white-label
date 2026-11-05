import Foundation

/// Operator points scheme as published by the server. Nil when the operator has none.
public struct LoyaltyProgramInfo: Codable, Sendable, Hashable {
    public var name: String
    public var earnPointsPerPound: Int
    public var redeemPointsPerPound: Int
    public var minRedeemPoints: Int

    public init(name: String, earnPointsPerPound: Int, redeemPointsPerPound: Int, minRedeemPoints: Int) {
        self.name = name; self.earnPointsPerPound = earnPointsPerPound; self.redeemPointsPerPound = redeemPointsPerPound; self.minRedeemPoints = minRedeemPoints
    }

    /// Plain-language summary, e.g. "10 points per £1 · £1 off per 200 points".
    public func summary(formatters: Formatters) -> String {
        "\(earnPointsPerPound) points per \(formatters.money(100)) · \(formatters.money(100)) off per \(redeemPointsPerPound) points"
    }
}

public struct LoyaltySummary: Codable, Sendable, Hashable {
    public struct Entry: Codable, Sendable, Hashable, Identifiable {
        public var id: String
        public var points: Int
        /// "earn" | "redeem" | "reverse_earn" | "refund_redeem" | "adjust"
        public var reason: String
        public var description: String
        public var balanceAfter: Int
        public var bookingId: String?
        public var createdAt: Date

        public init(id: String, points: Int, reason: String, description: String, balanceAfter: Int, bookingId: String? = nil, createdAt: Date) {
            self.id = id; self.points = points; self.reason = reason; self.description = description; self.balanceAfter = balanceAfter; self.bookingId = bookingId; self.createdAt = createdAt
        }

        public var title: String {
            switch reason {
            case "earn": return "Earned"
            case "redeem": return "Spent"
            case "reverse_earn": return "Removed (booking cancelled)"
            case "refund_redeem": return "Returned (booking cancelled)"
            default: return "Adjusted"
            }
        }
    }

    public var program: LoyaltyProgramInfo?
    public var points: Int
    /// What the balance is worth off a booking, in minor units.
    public var valueMinor: Int?
    public var history: [Entry]

    public init(program: LoyaltyProgramInfo?, points: Int, valueMinor: Int?, history: [Entry]) {
        self.program = program; self.points = points; self.valueMinor = valueMinor; self.history = history
    }

    public static let none = LoyaltySummary(program: nil, points: 0, valueMinor: nil, history: [])
}

public struct MembershipPlan: Codable, Sendable, Hashable, Identifiable {
    public struct Entitlements: Codable, Sendable, Hashable {
        public var ticketDiscountPercent: Int
        public var foodDiscountPercent: Int
        public var bookingFeeWaived: Bool
        public var pointsMultiplier: Double

        public init(ticketDiscountPercent: Int = 0, foodDiscountPercent: Int = 0, bookingFeeWaived: Bool = false, pointsMultiplier: Double = 1) {
            self.ticketDiscountPercent = ticketDiscountPercent; self.foodDiscountPercent = foodDiscountPercent; self.bookingFeeWaived = bookingFeeWaived; self.pointsMultiplier = pointsMultiplier
        }

        /// Benefits in plain words, in a stable order. Only non-trivial benefits are listed.
        public var benefits: [String] {
            var out: [String] = []
            if ticketDiscountPercent > 0 { out.append("\(ticketDiscountPercent)% off tickets") }
            if foodDiscountPercent > 0 { out.append("\(foodDiscountPercent)% off food and drink") }
            if bookingFeeWaived { out.append("No booking fees") }
            if pointsMultiplier > 1 {
                let m = pointsMultiplier.rounded() == pointsMultiplier ? String(Int(pointsMultiplier)) : String(format: "%.1f", pointsMultiplier)
                out.append("\(m)× points")
            }
            return out
        }
    }

    public var id: String
    public var name: String
    public var description: String
    public var priceMinor: Int
    /// "month" | "year"
    public var interval: String
    public var entitlements: Entitlements

    public init(id: String, name: String, description: String, priceMinor: Int, interval: String, entitlements: Entitlements) {
        self.id = id; self.name = name; self.description = description; self.priceMinor = priceMinor; self.interval = interval; self.entitlements = entitlements
    }

    public func priceLabel(formatters: Formatters) -> String { "\(formatters.money(priceMinor)) a \(interval == "year" ? "year" : "month")" }
}

public struct Membership: Codable, Sendable, Hashable {
    public var plan: MembershipPlan
    /// "active" | "expired"
    public var status: String
    public var startedAt: Date
    public var currentPeriodEnd: Date
    /// "manual" until a real payment provider supports recurring billing.
    public var renewal: String

    public init(plan: MembershipPlan, status: String, startedAt: Date, currentPeriodEnd: Date, renewal: String = "manual") {
        self.plan = plan; self.status = status; self.startedAt = startedAt; self.currentPeriodEnd = currentPeriodEnd; self.renewal = renewal
    }

    public var isActive: Bool { status == "active" }
}

/// What the app may offer a customer for a plan, given their current membership.
public enum MembershipOffer: Equatable, Sendable {
    case join
    case renew
    /// Another plan is active; switching waits until it ends.
    case unavailable(until: Date)

    public static func offer(for plan: MembershipPlan, current: Membership?) -> MembershipOffer {
        guard let current, current.isActive else { return .join }
        return current.plan.id == plan.id ? .renew : .unavailable(until: current.currentPeriodEnd)
    }
}
