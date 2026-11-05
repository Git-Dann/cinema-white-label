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

/// Progress towards the next whole-pound reward, for the rewards card.
public struct RewardProgress: Equatable, Sendable {
    /// Points still needed for the next £1 off (0 when one is ready).
    public let pointsToGo: Int
    /// 0...1 through the current step.
    public let fraction: Double
    /// True when the balance can already be spent.
    public let canRedeem: Bool
}

public extension LoyaltySummary {
    /// Where the balance sits against the next reward. Before the first reward the
    /// target is the larger of the minimum spend and one step; after that, each step.
    var nextReward: RewardProgress? {
        guard let p = program, p.redeemPointsPerPound > 0 else { return nil }
        let step = p.redeemPointsPerPound
        let first = max(p.minRedeemPoints, step)
        if points < first {
            return RewardProgress(pointsToGo: first - points, fraction: Double(points) / Double(first), canRedeem: false)
        }
        let into = points % step
        return RewardProgress(pointsToGo: step - into, fraction: Double(into) / Double(step), canRedeem: true)
    }
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
/// One membership benefit as shown on plan cards: a symbol, a short headline and a line of detail.
public struct MembershipBenefit: Hashable, Sendable {
    public let symbol: String
    public let title: String
    public let detail: String
}

public extension MembershipPlan.Entitlements {
    /// Benefits with icons and plain-English detail, strongest first. Only non-trivial benefits are listed.
    var benefitItems: [MembershipBenefit] {
        var out: [MembershipBenefit] = []
        if ticketDiscountPercent > 0 {
            out.append(.init(symbol: "ticket.fill", title: "\(ticketDiscountPercent)% off tickets", detail: "Every film, every screening"))
        }
        if bookingFeeWaived {
            out.append(.init(symbol: "creditcard.fill", title: "No booking fees", detail: "Pay the ticket price, nothing more"))
        }
        if foodDiscountPercent > 0 {
            out.append(.init(symbol: "popcorn.fill", title: "\(foodDiscountPercent)% off food and drink", detail: "Snacks with your booking or at your seat"))
        }
        if pointsMultiplier > 1 {
            let m = pointsMultiplier.rounded() == pointsMultiplier ? String(Int(pointsMultiplier)) : String(format: "%.1f", pointsMultiplier)
            out.append(.init(symbol: "sparkles", title: "\(m)× points", detail: "Earn rewards faster on everything"))
        }
        return out
    }

    /// Rough strength of a plan, used to pick the one to feature.
    var weight: Double { Double(ticketDiscountPercent) + Double(foodDiscountPercent) * 0.5 + (bookingFeeWaived ? 10 : 0) + (pointsMultiplier - 1) * 10 }
}

public extension Array where Element == MembershipPlan {
    /// The plan to feature as "best value": the strongest, when there is more than one plan.
    var featuredPlanID: String? {
        guard count > 1 else { return nil }
        return self.max { $0.entitlements.weight < $1.entitlements.weight }?.id
    }

    /// The cheapest plan, for "from £x a month" copy.
    var cheapest: MembershipPlan? { self.min { $0.priceMinor < $1.priceMinor } }
}

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
