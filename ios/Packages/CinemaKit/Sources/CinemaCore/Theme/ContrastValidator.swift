import Foundation

/// sRGB colour parsed from a #RRGGBB or #RRGGBBAA token.
public struct RGBA: Sendable, Hashable {
    public var red: Double
    public var green: Double
    public var blue: Double
    public var alpha: Double

    public init(red: Double, green: Double, blue: Double, alpha: Double = 1) {
        self.red = red; self.green = green; self.blue = blue; self.alpha = alpha
    }

    public init?(hex: String) {
        var s = hex
        guard s.hasPrefix("#") else { return nil }
        s.removeFirst()
        guard s.count == 6 || s.count == 8, let v = UInt64(s, radix: 16) else { return nil }
        if s.count == 8 {
            red = Double((v >> 24) & 0xFF) / 255; green = Double((v >> 16) & 0xFF) / 255
            blue = Double((v >> 8) & 0xFF) / 255; alpha = Double(v & 0xFF) / 255
        } else {
            red = Double((v >> 16) & 0xFF) / 255; green = Double((v >> 8) & 0xFF) / 255
            blue = Double(v & 0xFF) / 255; alpha = 1
        }
    }

    func composited(over bg: RGBA) -> RGBA {
        RGBA(red: red * alpha + bg.red * (1 - alpha), green: green * alpha + bg.green * (1 - alpha), blue: blue * alpha + bg.blue * (1 - alpha))
    }

    /// WCAG 2.2 relative luminance.
    public var relativeLuminance: Double {
        func ch(_ c: Double) -> Double { c <= 0.04045 ? c / 12.92 : pow((c + 0.055) / 1.055, 2.4) }
        return 0.2126 * ch(red) + 0.7152 * ch(green) + 0.0722 * ch(blue)
    }
}

/// Client-side guard: the backend validates before publishing, but the app
/// independently refuses a configuration that would be unreadable, keeping
/// its last known-good version instead.
public enum ContrastValidator {
    public struct Requirement: Sendable { public let fg: String; public let bg: String; public let min: Double }

    /// Mirrors CONTRAST_REQUIREMENTS in packages/contracts/src/theme.ts.
    public static let requirements: [Requirement] = [
        .init(fg: "textPrimary", bg: "background", min: 4.5),
        .init(fg: "textSecondary", bg: "background", min: 4.5),
        .init(fg: "textMuted", bg: "background", min: 4.5),
        .init(fg: "textPrimary", bg: "surface", min: 4.5),
        .init(fg: "textSecondary", bg: "surface", min: 4.5),
        .init(fg: "textMuted", bg: "surface", min: 4.5),
        .init(fg: "actionPrimaryText", bg: "actionPrimary", min: 4.5),
        .init(fg: "actionSecondaryText", bg: "actionSecondary", min: 4.5),
        .init(fg: "selectedText", bg: "selected", min: 4.5),
        .init(fg: "membershipText", bg: "membership", min: 4.5),
        .init(fg: "error", bg: "background", min: 4.5),
        .init(fg: "warning", bg: "background", min: 4.5),
        .init(fg: "success", bg: "background", min: 4.5),
        .init(fg: "focus", bg: "background", min: 3),
        .init(fg: "seatAvailableBorder", bg: "background", min: 3),
        .init(fg: "seatSelected", bg: "background", min: 3),
        .init(fg: "seatSelectedText", bg: "seatSelected", min: 4.5),
        .init(fg: "seatHeld", bg: "background", min: 3),
        .init(fg: "seatPremium", bg: "background", min: 3),
        .init(fg: "seatAccessible", bg: "background", min: 3),
        .init(fg: "seatCompanion", bg: "background", min: 3),
        .init(fg: "seatRestricted", bg: "background", min: 3),
        .init(fg: "screen", bg: "background", min: 3),
    ]

    public static func ratio(_ fg: String, _ bg: String) -> Double? {
        guard var b = RGBA(hex: bg), var f = RGBA(hex: fg) else { return nil }
        if b.alpha < 1 { b = b.composited(over: RGBA(red: 0, green: 0, blue: 0)) }
        if f.alpha < 1 { f = f.composited(over: b) }
        let l1 = f.relativeLuminance, l2 = b.relativeLuminance
        return (max(l1, l2) + 0.05) / (min(l1, l2) + 0.05)
    }

    public struct Issue: Sendable, Hashable, CustomStringConvertible {
        public let appearance: String, fg: String, bg: String, ratio: Double, required: Double
        public var description: String { "\(appearance): \(fg) on \(bg) is \(String(format: "%.2f", ratio)):1, needs \(required):1" }
    }

    public static func validate(_ theme: ResolvedTheme) -> [Issue] {
        var issues: [Issue] = []
        let sets: [(String, SemanticTokens)] = switch theme.appearancePolicy {
        case .alwaysDark: [("dark", theme.dark)]
        case .alwaysLight: [("light", theme.light)]
        case .system: [("light", theme.light), ("dark", theme.dark)]
        }
        for (name, tokens) in sets {
            for r in requirements {
                guard let fg = tokens[token: r.fg], let bg = tokens[token: r.bg], let ratio = ratio(fg, bg) else {
                    issues.append(Issue(appearance: name, fg: r.fg, bg: r.bg, ratio: 0, required: r.min))
                    continue
                }
                if ratio + 1e-9 < r.min { issues.append(Issue(appearance: name, fg: r.fg, bg: r.bg, ratio: ratio, required: r.min)) }
            }
        }
        return issues
    }
}
