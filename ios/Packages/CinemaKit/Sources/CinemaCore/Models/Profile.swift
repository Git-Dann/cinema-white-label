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
