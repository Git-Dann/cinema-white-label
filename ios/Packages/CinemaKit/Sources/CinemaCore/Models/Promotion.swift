import Foundation

/// Operator promotion for the home screen's Offers section. The server only
/// returns live promotions whose target still works (a redeemable voucher, a
/// listed film), so the app shows them as given.
public struct Promotion: Codable, Sendable, Hashable, Identifiable {
    public enum Action: Sendable, Hashable {
        case film(id: String)
        case voucher(code: String)
        case link(URL)
        case none
    }

    public var id: String
    public var title: String
    public var body: String
    /// Button label; nil when the promotion is information only.
    public var ctaLabel: String?
    public var action: Action
    public var validTo: Date?

    public init(id: String, title: String, body: String, ctaLabel: String?, action: Action, validTo: Date? = nil) {
        self.id = id
        self.title = title
        self.body = body
        self.ctaLabel = ctaLabel
        self.action = action
        self.validTo = validTo
    }

    /// Whether the card should show a button. Unknown or unsafe actions decode to `.none`.
    public var hasButton: Bool { action != .none && !(ctaLabel ?? "").isEmpty }
}

extension Promotion.Action: Codable {
    private enum Keys: String, CodingKey { case kind, filmId, code, url }

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        switch try c.decodeIfPresent(String.self, forKey: .kind) {
        case "film":
            if let id = try c.decodeIfPresent(String.self, forKey: .filmId), !id.isEmpty { self = .film(id: id) } else { self = .none }
        case "voucher":
            if let code = try c.decodeIfPresent(String.self, forKey: .code), !code.isEmpty { self = .voucher(code: code) } else { self = .none }
        case "link":
            // Only https links are opened, whatever the server sends.
            if let s = try c.decodeIfPresent(String.self, forKey: .url), let url = URL(string: s), url.scheme?.lowercased() == "https", url.host != nil {
                self = .link(url)
            } else { self = .none }
        default:
            self = .none
        }
    }

    public func encode(to encoder: any Encoder) throws {
        var c = encoder.container(keyedBy: Keys.self)
        switch self {
        case .film(let id): try c.encode("film", forKey: .kind); try c.encode(id, forKey: .filmId)
        case .voucher(let code): try c.encode("voucher", forKey: .kind); try c.encode(code, forKey: .code)
        case .link(let url): try c.encode("link", forKey: .kind); try c.encode(url.absoluteString, forKey: .url)
        case .none: try c.encode("none", forKey: .kind)
        }
    }
}
