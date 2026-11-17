import Foundation

/// How the customer's avatar is dressed: plain, a member, or a member of the operator's top plan
/// (the equivalent of a Limitless or Premiere card).
public enum AvatarTier: Equatable, Sendable {
    case guest
    case member(planName: String)
    /// The most expensive plan on sale.
    case premium(planName: String)

    public init(membership: Membership?, plans: [MembershipPlan]) {
        guard let m = membership, m.isActive else { self = .guest; return }
        let top = plans.max { $0.priceMinor < $1.priceMinor }
        self = (plans.count > 1 && m.plan.id == top?.id) ? .premium(planName: m.plan.name) : .member(planName: m.plan.name)
    }

    public var planName: String? {
        switch self { case .guest: nil; case .member(let n), .premium(let n): n }
    }

    public var isPremium: Bool { if case .premium = self { true } else { false } }

    /// The short tag on the avatar: the plan name without the operator's name, e.g.
    /// "Northlight Premiere" → "PREMIERE", "ODEON Limitless" → "LIMITLESS". Nil for guests.
    public func tag(operatorWordmark: String) -> String? {
        guard var name = planName?.trimmingCharacters(in: .whitespaces), !name.isEmpty else { return nil }
        let prefix = operatorWordmark.trimmingCharacters(in: .whitespaces)
        if !prefix.isEmpty, name.lowercased().hasPrefix(prefix.lowercased() + " ") {
            name = String(name.dropFirst(prefix.count)).trimmingCharacters(in: .whitespaces)
        }
        // Drop a trailing "membership" or "member"; the tag already says it.
        for suffix in [" membership", " member"] where name.lowercased().hasSuffix(suffix) {
            name = String(name.dropLast(suffix.count))
        }
        return name.uppercased()
    }
}

/// The customer's own photo for their avatar. Kept on this device only: never uploaded, and the
/// same photo whichever cinema they book with.
public struct ProfilePhotoStore: Sendable {
    public let directory: URL
    public init(directory: URL) { self.directory = directory }

    private var url: URL { directory.appendingPathComponent("profile-photo.jpg") }

    public func load() -> Data? { try? Data(contentsOf: url) }

    /// Saves an already-resized JPEG. Refuses anything over 2 MB so a full-size photo can't be kept by mistake.
    public func save(_ jpeg: Data) throws {
        guard jpeg.count <= Self.maxBytes else { throw PhotoError.tooLarge }
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try jpeg.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    public func remove() { try? FileManager.default.removeItem(at: url) }

    public static let maxBytes = 2_000_000
    /// Longest side the photo is resized to before saving: plenty for an avatar at @3x.
    public static let pixelSize = 360
    public enum PhotoError: Error, Equatable { case tooLarge }
}

/// What the customer tells us about themselves (`/me/profile`). Everything is optional: booking as a
/// guest needs none of it. Mirrors `CustomerProfile` in packages/contracts/src/profile.ts.
public struct CustomerProfile: Codable, Sendable, Hashable {
    public var givenName: String?
    public var familyName: String?
    public var email: String?
    public var phone: String?
    /// Offers and news by email. Off unless the customer turns it on.
    public var marketingOptIn: Bool
    /// Set by the server when it saved them.
    public var updatedAt: String?

    public init(givenName: String? = nil, familyName: String? = nil, email: String? = nil, phone: String? = nil, marketingOptIn: Bool = false, updatedAt: String? = nil) {
        self.givenName = givenName; self.familyName = familyName; self.email = email; self.phone = phone; self.marketingOptIn = marketingOptIn; self.updatedAt = updatedAt
    }

    public static let empty = CustomerProfile()

    public enum Field: String, Sendable, CaseIterable { case givenName, familyName, email, phone, marketingOptIn }

    public var fullName: String? {
        let n = [givenName, familyName].compactMap { $0?.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
        return n.isEmpty ? nil : n
    }

    /// "DL" for Dan Lindsay, for the avatar when there is no photo.
    public var initials: String? {
        let parts = [givenName, familyName].compactMap { $0?.trimmingCharacters(in: .whitespaces).first }.map { String($0).uppercased() }
        return parts.isEmpty ? nil : parts.joined()
    }

    public var isEmpty: Bool { tidied() == CustomerProfile(marketingOptIn: false, updatedAt: tidied().updatedAt) }

    /// Trimmed, empty strings as nil, email in lower case: the same as the server stores.
    public func tidied() -> CustomerProfile {
        func t(_ s: String?) -> String? {
            guard let s = s?.trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
            return s
        }
        return CustomerProfile(givenName: t(givenName), familyName: t(familyName), email: t(email)?.lowercased(), phone: t(phone), marketingOptIn: marketingOptIn, updatedAt: updatedAt)
    }

    /// What's wrong, field by field, in words to show under the field. Empty when it can be saved.
    public func problems() -> [Field: String] {
        let p = tidied()
        var out: [Field: String] = [:]
        if (p.givenName?.count ?? 0) > 60 { out[.givenName] = "Use 60 characters or fewer" }
        if (p.familyName?.count ?? 0) > 60 { out[.familyName] = "Use 60 characters or fewer" }
        if let e = p.email, e.range(of: #"^[^\s@]+@[^\s@]+\.[^\s@]{2,}$"#, options: .regularExpression) == nil {
            out[.email] = "Enter an email address like name@example.com"
        }
        if let ph = p.phone, ph.range(of: #"^\+?[0-9 ()-]{7,20}$"#, options: .regularExpression) == nil {
            out[.phone] = "Enter a phone number"
        }
        if p.marketingOptIn && p.email == nil { out[.marketingOptIn] = "Add an email address to get offers by email" }
        return out
    }

    /// The fields the customer can change, for comparing local and server copies.
    public var details: CustomerProfile { var c = tidied(); c.updatedAt = nil; return c }
}

/// The profile kept on this device, so it follows the customer between cinemas in the shared app
/// and is sent to whichever operator they book with.
public struct ProfileStore: Sendable {
    public let directory: URL
    public init(directory: URL) { self.directory = directory }
    private var url: URL { directory.appendingPathComponent("profile.json") }

    public func load() -> CustomerProfile {
        guard let data = try? Data(contentsOf: url), let p = try? JSONDecoder().decode(CustomerProfile.self, from: data) else { return .empty }
        return p
    }

    public func save(_ profile: CustomerProfile) throws {
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        try JSONEncoder().encode(profile.tidied()).write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    public func clear() { try? FileManager.default.removeItem(at: url) }
}
