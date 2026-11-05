import SwiftUI
import CinemaCore

public extension Color {
    /// Creates a colour from a #RRGGBB or #RRGGBBAA token.
    init(hex: String) {
        let c = RGBA(hex: hex) ?? RGBA(red: 1, green: 0, blue: 1)
        self.init(.sRGB, red: c.red, green: c.green, blue: c.blue, opacity: c.alpha)
    }
}

/// Semantic colours for the current theme and appearance. Views only ever use
/// these tokens, never literal colours, so every operator theme just works.
public struct Palette: Equatable {
    public let background, backgroundElevated, surface, surfaceElevated: Color
    public let textPrimary, textSecondary, textMuted: Color
    public let actionPrimary, actionPrimaryText, actionSecondary, actionSecondaryText: Color
    public let selected, selectedText, divider, border, focus: Color
    public let error, warning, success, artworkScrim, membership, membershipText: Color
    public let seatAvailable, seatAvailableBorder, seatSelected, seatSelectedText, seatHeld, seatSold: Color
    public let seatUnavailable, seatPremium, seatAccessible, seatCompanion, seatRestricted, seatBlocked, screen: Color
    public let cornerRadius: ResolvedTheme.CornerRadius

    public init(tokens t: SemanticTokens, cornerRadius: ResolvedTheme.CornerRadius) {
        background = Color(hex: t.background); backgroundElevated = Color(hex: t.backgroundElevated)
        surface = Color(hex: t.surface); surfaceElevated = Color(hex: t.surfaceElevated)
        textPrimary = Color(hex: t.textPrimary); textSecondary = Color(hex: t.textSecondary); textMuted = Color(hex: t.textMuted)
        actionPrimary = Color(hex: t.actionPrimary); actionPrimaryText = Color(hex: t.actionPrimaryText)
        actionSecondary = Color(hex: t.actionSecondary); actionSecondaryText = Color(hex: t.actionSecondaryText)
        selected = Color(hex: t.selected); selectedText = Color(hex: t.selectedText)
        divider = Color(hex: t.divider); border = Color(hex: t.border); focus = Color(hex: t.focus)
        error = Color(hex: t.error); warning = Color(hex: t.warning); success = Color(hex: t.success)
        artworkScrim = Color(hex: t.artworkScrim); membership = Color(hex: t.membership); membershipText = Color(hex: t.membershipText)
        seatAvailable = Color(hex: t.seatAvailable); seatAvailableBorder = Color(hex: t.seatAvailableBorder)
        seatSelected = Color(hex: t.seatSelected); seatSelectedText = Color(hex: t.seatSelectedText)
        seatHeld = Color(hex: t.seatHeld); seatSold = Color(hex: t.seatSold); seatUnavailable = Color(hex: t.seatUnavailable)
        seatPremium = Color(hex: t.seatPremium); seatAccessible = Color(hex: t.seatAccessible); seatCompanion = Color(hex: t.seatCompanion)
        seatRestricted = Color(hex: t.seatRestricted); seatBlocked = Color(hex: t.seatBlocked); screen = Color(hex: t.screen)
        self.cornerRadius = cornerRadius
    }

    public static let fallback = Palette(
        tokens: SemanticTokens(
            background: "#0E0E11", backgroundElevated: "#18181C", surface: "#1C1C21", surfaceElevated: "#26262C",
            textPrimary: "#F5F5F7", textSecondary: "#C7C7CC", textMuted: "#9A9AA2", actionPrimary: "#0A84FF", actionPrimaryText: "#FFFFFF",
            actionSecondary: "#2E2E35", actionSecondaryText: "#F5F5F7", selected: "#0A84FF", selectedText: "#FFFFFF", divider: "#2E2E35",
            border: "#8E8E93", focus: "#7DB4FF", error: "#FF6B6B", warning: "#FFC24B", success: "#4ADE80", artworkScrim: "#0E0E11B8",
            membership: "#F5C451", membershipText: "#0B0B0F", seatAvailable: "#2B2B31", seatAvailableBorder: "#8E8E93", seatSelected: "#0A84FF",
            seatSelectedText: "#FFFFFF", seatHeld: "#B08A2E", seatSold: "#2A2A2F", seatUnavailable: "#222227", seatPremium: "#F5C451",
            seatAccessible: "#4C9AFF", seatCompanion: "#3FC1C9", seatRestricted: "#C9A26B", seatBlocked: "#1E1E22", screen: "#C5CDDA"
        ),
        cornerRadius: .init(small: 10, medium: 16, large: 24)
    )
}

private struct PaletteKey: EnvironmentKey { static let defaultValue = Palette.fallback }
private struct HeadingWeightKey: EnvironmentKey { static let defaultValue: Font.Weight = .bold }
private struct MediaBaseURLKey: EnvironmentKey { static let defaultValue = URL(string: "http://localhost:3000/")! }

public extension EnvironmentValues {
    var palette: Palette {
        get { self[PaletteKey.self] }
        set { self[PaletteKey.self] = newValue }
    }
    /// Operator heading weight from tenant typography.
    var headingWeight: Font.Weight {
        get { self[HeadingWeightKey.self] }
        set { self[HeadingWeightKey.self] = newValue }
    }
    /// Base URL used to resolve relative media URLs from the API.
    var mediaBaseURL: URL {
        get { self[MediaBaseURLKey.self] }
        set { self[MediaBaseURLKey.self] = newValue }
    }
}

/// Applies a resolved operator theme: picks light/dark tokens for the current
/// colour scheme and enforces the theme's appearance policy.
public struct CinemaThemeModifier: ViewModifier {
    let theme: ResolvedTheme
    var typography: Typography = .standard
    @Environment(\.colorScheme) private var systemScheme

    public func body(content: Content) -> some View {
        let scheme: ColorScheme = switch theme.appearancePolicy {
        case .alwaysDark: .dark
        case .alwaysLight: .light
        case .system: systemScheme
        }
        let palette = Palette(tokens: scheme == .dark ? theme.dark : theme.light, cornerRadius: theme.cornerRadius)
        return content
            .environment(\.palette, palette)
            .tint(palette.actionPrimary)
            .preferredColorScheme(theme.appearancePolicy == .system ? nil : scheme)
            // System fonts only: operators pick a design; Dynamic Type always applies.
            .fontDesign(typography.design == .serif ? .serif : typography.design == .rounded ? .rounded : .default)
            .environment(\.headingWeight, typography.headingWeight == .heavy ? .heavy : typography.headingWeight == .semibold ? .semibold : .bold)
    }
}

public extension View {
    func cinemaTheme(_ theme: ResolvedTheme, typography: Typography = .standard) -> some View { modifier(CinemaThemeModifier(theme: theme, typography: typography)) }
}
