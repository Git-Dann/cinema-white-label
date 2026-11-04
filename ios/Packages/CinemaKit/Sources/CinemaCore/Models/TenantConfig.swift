import Foundation

/// Runtime tenant configuration, mirroring `packages/contracts/src/tenant.ts`.
/// Build-time identity (bundle ID, icon, entitlements) lives in the Xcode build
/// configuration, not here.
public struct TenantConfig: Codable, Sendable, Hashable {
    public static let supportedSchemaVersion = 1

    public var schemaVersion: Int
    public var version: Int
    public var publishedAt: String
    public var tenant: TenantIdentity
    public var branding: Branding
    public var theme: ResolvedTheme
    public var availableThemes: [ThemeID]
    public var alternateThemes: [ResolvedTheme]
    public var features: FeatureFlags
    public var home: [HomeSection]
    public var support: Support
    public var legal: Legal
    public var booking: BookingSettings

    public init(from decoder: any Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try c.decode(Int.self, forKey: .schemaVersion)
        version = try c.decode(Int.self, forKey: .version)
        publishedAt = try c.decode(String.self, forKey: .publishedAt)
        tenant = try c.decode(TenantIdentity.self, forKey: .tenant)
        branding = try c.decode(Branding.self, forKey: .branding)
        theme = try c.decode(ResolvedTheme.self, forKey: .theme)
        // Unknown theme ids from a newer backend are ignored rather than failing the whole config.
        availableThemes = (try c.decode([String].self, forKey: .availableThemes)).compactMap(ThemeID.init(rawValue:))
        alternateThemes = try c.decodeIfPresent([ResolvedTheme].self, forKey: .alternateThemes) ?? []
        features = try c.decode(FeatureFlags.self, forKey: .features)
        home = try c.decode([HomeSection].self, forKey: .home)
        support = try c.decode(Support.self, forKey: .support)
        legal = try c.decode(Legal.self, forKey: .legal)
        booking = try c.decode(BookingSettings.self, forKey: .booking)
    }

    public struct TenantIdentity: Codable, Sendable, Hashable {
        public var id: String
        public var slug: String
        public var name: String
        public var locale: String
        public var currency: String
        public var timeZone: String
    }

    public struct Branding: Codable, Sendable, Hashable {
        public var logoLightUrl: String?
        public var logoDarkUrl: String?
        public var markUrl: String?
        public var wordmark: String
        public var palette: BrandPalette
    }

    public struct BrandPalette: Codable, Sendable, Hashable {
        public struct Pair: Codable, Sendable, Hashable { public var light: String; public var dark: String }
        public var id: String
        public var name: String
        public var accent: Pair
        public var secondary: Pair
    }

    public struct FeatureFlags: Codable, Sendable, Hashable {
        public var memberships: Bool
        public var concessions: Bool
        public var wallet: Bool
        public var applePay: Bool
        public var liveActivities: Bool
        public var guestCheckout: Bool
    }

    public struct HomeSection: Codable, Sendable, Hashable, Identifiable {
        public enum Kind: String, Codable, Sendable { case featured, nowShowing, comingSoon, upcomingBookings, promotion, collection, unknown
            public init(from decoder: any Decoder) throws { self = Kind(rawValue: try decoder.singleValueContainer().decode(String.self)) ?? .unknown }
        }
        public var id: String
        public var kind: Kind
        public var title: String
        public var subtitle: String?
        public var collectionId: String?
    }

    public struct Support: Codable, Sendable, Hashable { public var email: String; public var phone: String?; public var url: String? }
    public struct Legal: Codable, Sendable, Hashable { public var termsUrl: String; public var privacyUrl: String; public var companyName: String }
    public struct BookingSettings: Codable, Sendable, Hashable { public var maxTicketsPerBooking: Int; public var holdDurationSeconds: Int }

    /// All themes the customer can choose from, current theme first.
    public var allThemes: [ResolvedTheme] { [theme] + alternateThemes.filter { $0.themeId != theme.themeId } }
}

public enum ThemeID: String, Codable, Sendable, Hashable, CaseIterable {
    case classic, midnight, premium, light, highContrast
}

public enum AppearancePolicy: String, Codable, Sendable, Hashable {
    case system, alwaysDark, alwaysLight
}

public struct ResolvedTheme: Codable, Sendable, Hashable {
    public struct CornerRadius: Codable, Sendable, Hashable { public var small: Double; public var medium: Double; public var large: Double }
    public var themeId: ThemeID
    public var name: String
    public var appearancePolicy: AppearancePolicy
    public var light: SemanticTokens
    public var dark: SemanticTokens
    public var cornerRadius: CornerRadius
}

/// Semantic colour tokens as #RRGGBB / #RRGGBBAA strings. See docs/theme-system.md.
public struct SemanticTokens: Codable, Sendable, Hashable {
    public var background: String
    public var backgroundElevated: String
    public var surface: String
    public var surfaceElevated: String
    public var textPrimary: String
    public var textSecondary: String
    public var textMuted: String
    public var actionPrimary: String
    public var actionPrimaryText: String
    public var actionSecondary: String
    public var actionSecondaryText: String
    public var selected: String
    public var selectedText: String
    public var divider: String
    public var border: String
    public var focus: String
    public var error: String
    public var warning: String
    public var success: String
    public var artworkScrim: String
    public var membership: String
    public var membershipText: String
    public var seatAvailable: String
    public var seatAvailableBorder: String
    public var seatSelected: String
    public var seatSelectedText: String
    public var seatHeld: String
    public var seatSold: String
    public var seatUnavailable: String
    public var seatPremium: String
    public var seatAccessible: String
    public var seatCompanion: String
    public var seatRestricted: String
    public var seatBlocked: String
    public var screen: String

    /// Key-path lookup by contract token name, used by the contrast validator.
    public subscript(token token: String) -> String? {
        let mirror = Mirror(reflecting: self)
        return mirror.children.first { $0.label == token }?.value as? String
    }
}
