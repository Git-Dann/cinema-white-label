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
    /// Banner photo. For a film offer without its own photo the server sends the film's backdrop.
    public var image: ImageRef?

    public init(id: String, title: String, body: String, ctaLabel: String?, action: Action, validTo: Date? = nil, image: ImageRef? = nil) {
        self.id = id
        self.title = title
        self.body = body
        self.ctaLabel = ctaLabel
        self.action = action
        self.validTo = validTo
        self.image = image
    }

    /// The banner's two lines: a small lead and a big headline. Mirrors
    /// `bannerLines` in the operator portal so its preview matches the phone.
    /// - A saving in the title ("10% off", "£2 off", "2 for 1") is the headline.
    /// - A film offer leads with its title and makes the film's name the headline.
    /// - Otherwise the last word is the headline ("Pre-order your" / "SNACKS").
    public func bannerLines(filmTitle: String? = nil) -> (lead: String, headline: String) {
        let text = title.trimmingCharacters(in: .whitespacesAndNewlines)
        for pattern in [#"\d+%\s*off"#, #"£\d+(?:\.\d{2})?\s*off"#, #"\d\s*for\s*\d"#] {
            if let r = text.range(of: pattern, options: [.regularExpression, .caseInsensitive]) {
                return (Self.tidy(text.replacingCharacters(in: r, with: "")), String(text[r]).uppercased())
            }
        }
        if let filmTitle, !filmTitle.isEmpty { return (Self.tidy(text), filmTitle.uppercased()) }
        let words = text.split(whereSeparator: \.isWhitespace).map(String.init)
        guard words.count > 1, let last = words.last else { return ("", text.uppercased()) }
        return (Self.tidy(words.dropLast().joined(separator: " ")), Self.tidy(last).uppercased())
    }

    /// The sticker stamped on the offer's photo, shelf-edge style: the code to use,
    /// "On sale now" for a film, otherwise "New". Mirrors `stickerLines` in the portal.
    public var stickerLines: [String] {
        switch action {
        case .voucher(let code): ["USE CODE", code]
        case .film: ["ON SALE", "NOW"]
        default: ["NEW"]
        }
    }

    private static func tidy(_ s: String) -> String {
        let edges = CharacterSet.whitespacesAndNewlines.union(CharacterSet(charactersIn: ",.:;–-"))
        return s.components(separatedBy: .whitespaces).filter { !$0.isEmpty }.joined(separator: " ").trimmingCharacters(in: edges)
    }

    /// Whether the card should show a button. Unknown or unsafe actions decode to `.none`.
    public var hasButton: Bool { action != .none && !(ctaLabel ?? "").isEmpty }
    public var isVoucher: Bool { if case .voucher = action { true } else { false } }
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
