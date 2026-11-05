import Foundation

/// The last rewards and membership state the server sent, kept on disk so the
/// Account cards show instantly on the next launch while a fresh copy loads.
/// Display only: the server stays authoritative and every launch refreshes it.
public struct AccountSnapshot: Codable, Sendable, Hashable {
    public var loyalty: LoyaltySummary
    public var membership: Membership?
    public var membershipPlans: [MembershipPlan]

    public init(loyalty: LoyaltySummary = .none, membership: Membership? = nil, membershipPlans: [MembershipPlan] = []) {
        self.loyalty = loyalty; self.membership = membership; self.membershipPlans = membershipPlans
    }

    public static let empty = AccountSnapshot()

    /// Merges a refresh into the current state. A request that failed (`nil`)
    /// keeps what we had, so a dropped connection never blanks the cards.
    /// `membership` is doubly optional: `.some(nil)` means "the server says no membership".
    public func merging(loyalty: LoyaltySummary?, membership: Membership??, plans: [MembershipPlan]?) -> AccountSnapshot {
        var next = self
        if let loyalty { next.loyalty = loyalty }
        if let membership { next.membership = membership }
        if let plans { next.membershipPlans = plans }
        return next
    }
}

/// Reads and writes `AccountSnapshot` as JSON in the app's support directory.
public struct AccountSnapshotStore: Sendable {
    public let url: URL

    public init(cacheDirectory: URL, tenantSlug: String) {
        url = cacheDirectory.appendingPathComponent("account-\(tenantSlug).json")
    }

    public func load() -> AccountSnapshot? {
        guard let data = try? Data(contentsOf: url) else { return nil }
        return try? APIClient.decoder.decode(AccountSnapshot.self, from: data)
    }

    public func save(_ snapshot: AccountSnapshot) {
        let enc = JSONEncoder()
        enc.dateEncodingStrategy = .custom { date, encoder in
            var c = encoder.singleValueContainer()
            let f = ISO8601DateFormatter(); f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            try c.encode(f.string(from: date))
        }
        do {
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            #if os(Linux)
            try enc.encode(snapshot).write(to: url, options: [.atomic])
            #else
            try enc.encode(snapshot).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            #endif
        } catch {}
    }
}
