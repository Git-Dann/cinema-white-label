import SwiftUI

/// One spacing scale for the whole app. Screens use these, never ad-hoc numbers,
/// so margins, gaps and card insets line up from screen to screen.
public enum Spacing {
    public static let xxs: CGFloat = 4
    public static let xs: CGFloat = 8
    public static let s: CGFloat = 12
    public static let m: CGFloat = 16
    public static let l: CGFloat = 20
    public static let xl: CGFloat = 24
    public static let xxl: CGFloat = 32

    /// Left and right margin for all scrolling content (matches inset-grouped lists).
    public static let page: CGFloat = 20
    /// Gap between sections on a screen.
    public static let section: CGFloat = 32
    /// Gap between a section header and its content.
    public static let header: CGFloat = 12
    /// Gap between items in a horizontal carousel or grid.
    public static let item: CGFloat = 14
    /// Padding inside cards.
    public static let card: CGFloat = 16
    /// Minimum tap target.
    public static let tap: CGFloat = 44
}

public extension View {
    /// Standard left and right page margin.
    func pagePadding() -> some View { padding(.horizontal, Spacing.page) }

    /// Padding for a primary action pinned to the bottom of a screen (Continue, Pay).
    func bottomActionPadding() -> some View {
        padding(.horizontal, Spacing.page).padding(.top, Spacing.s).padding(.bottom, Spacing.xs)
    }

    /// The one card look: surface, large continuous corners, hairline border, standard inset.
    func cardStyle(padding: CGFloat = Spacing.card) -> some View { modifier(CardStyle(padding: padding)) }
}

struct CardStyle: ViewModifier {
    let padding: CGFloat
    @Environment(\.palette) private var palette

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(palette.surface, in: RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous).strokeBorder(palette.border.opacity(0.5)))
    }
}

/// Selectable capsule used for dates, filters and segment-like choices.
public struct Chip: View {
    let title: String
    let selected: Bool
    let action: () -> Void
    @Environment(\.palette) private var palette

    public init(_ title: String, selected: Bool, action: @escaping () -> Void) {
        self.title = title; self.selected = selected; self.action = action
    }

    public var body: some View {
        Button(action: action) {
            Text(title)
                .font(.subheadline.weight(.semibold))
                .lineLimit(1)
                .padding(.horizontal, Spacing.m)
                .frame(minHeight: Spacing.tap)
                .foregroundStyle(selected ? palette.selectedText : palette.textPrimary)
                .background(selected ? palette.selected : palette.surfaceElevated, in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

/// Compact secondary button for use inside cards: intrinsic width, 44pt tall.
public struct CompactButtonStyle: ButtonStyle {
    @Environment(\.palette) private var palette
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.subheadline.weight(.semibold))
            .lineLimit(1)
            .padding(.horizontal, Spacing.l)
            .frame(minHeight: Spacing.tap)
            .foregroundStyle(palette.textPrimary)
            .background(palette.surfaceElevated, in: Capsule())
            .overlay(Capsule().strokeBorder(palette.border.opacity(0.6)))
            .opacity(configuration.isPressed ? 0.8 : 1)
            .contentShape(Capsule())
    }
}

public extension ButtonStyle where Self == CompactButtonStyle { static var cinemaCompact: CompactButtonStyle { .init() } }

/// Label above value, as rows inside a card, separated by hairlines.
public struct DetailRows: View {
    let rows: [(label: String, value: String)]
    @Environment(\.palette) private var palette

    public init(_ rows: [(label: String, value: String)]) { self.rows = rows }

    public var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                if index > 0 { Divider().overlay(palette.divider).padding(.vertical, Spacing.s) }
                VStack(alignment: .leading, spacing: Spacing.xxs) {
                    Text(row.label).font(.subheadline).foregroundStyle(palette.textMuted)
                    Text(row.value).font(.body).foregroundStyle(palette.textPrimary).fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .accessibilityElement(children: .combine)
            }
        }
        .cardStyle()
    }
}
