import Foundation

/// The server's answer to "is this app version still fine?" (`GET /app-status`).
/// Mirrors `AppStatus` in packages/contracts/src/fleet.ts. The server decides; the app only shows it.
public struct AppStatus: Codable, Sendable, Hashable {
    public enum Kind: String, Codable, Sendable {
        case current
        case updateAvailable = "update-available"
        case updateRequired = "update-required"
    }

    public var status: Kind
    public var latestVersion: String
    public var minimumVersion: String
    public var message: String?
    public var storeUrl: URL?

    public init(status: Kind, latestVersion: String, minimumVersion: String, message: String? = nil, storeUrl: URL? = nil) {
        self.status = status; self.latestVersion = latestVersion; self.minimumVersion = minimumVersion; self.message = message; self.storeUrl = storeUrl
    }
}

/// What the app shows for an `AppStatus`.
public enum UpdatePrompt: Equatable, Sendable {
    case none
    /// A one-off, dismissible suggestion for this latest version.
    case suggest(AppStatus)
    /// The app is too old to work with the platform: it blocks until updated.
    case require(AppStatus)

    /// - Parameters:
    ///   - status: the server's answer, or nil when it couldn't be reached (offline never blocks anyone).
    ///   - dismissedVersion: the latest version the customer already said "Not now" to.
    public static func decide(_ status: AppStatus?, dismissedVersion: String?) -> UpdatePrompt {
        guard let status else { return .none }
        switch status.status {
        case .current:
            return .none
        case .updateRequired:
            return .require(status)
        case .updateAvailable:
            // Nothing to tap without a store link, and never nag twice about the same version.
            guard status.storeUrl != nil, dismissedVersion != status.latestVersion else { return .none }
            return .suggest(status)
        }
    }

    /// The text for the prompt, in plain words.
    public var title: String {
        switch self {
        case .none: ""
        case .suggest: "A new version is ready"
        case .require: "Please update the app"
        }
    }

    public var body: String {
        switch self {
        case .none: return ""
        case .suggest(let s): return s.message ?? "Version \(s.latestVersion) is in the App Store."
        case .require(let s):
            let reason = s.message.map { " \($0)" } ?? ""
            return "This version can no longer book tickets.\(reason) Your tickets are safe and will be there after updating."
        }
    }
}
