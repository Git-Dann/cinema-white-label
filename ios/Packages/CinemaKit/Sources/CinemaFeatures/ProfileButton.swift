import SwiftUI
import CinemaCore
import CinemaDesign

/// How the customer's avatar is dressed: plain, a member ring, or the top plan's animated ring.
enum AvatarTier: Equatable {
    case guest
    case member(planName: String)
    /// The most expensive plan on sale, e.g. Premiere.
    case premium(planName: String)

    init(membership: Membership?, plans: [MembershipPlan]) {
        guard let m = membership, m.isActive else { self = .guest; return }
        let top = plans.max { $0.priceMinor < $1.priceMinor }
        self = (plans.count > 1 && m.plan.id == top?.id) ? .premium(planName: m.plan.name) : .member(planName: m.plan.name)
    }

    var planName: String? {
        switch self { case .guest: nil; case .member(let n), .premium(let n): n }
    }
}

/// The customer's avatar. Members get a ring in the membership colour and a small
/// badge; the top plan's ring slowly turns, catching the light. Guests have no
/// name on file, so the avatar is the person symbol on a soft disc.
struct AvatarView: View {
    let tier: AvatarTier
    var size: CGFloat = 34
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var spin = false

    var body: some View {
        ZStack {
            Circle().fill(palette.surfaceElevated)
            Image(systemName: "person.fill")
                .font(.system(size: size * 0.48, weight: .semibold))
                .foregroundStyle(tier == .guest ? palette.textSecondary : palette.membership)
                .offset(y: size * 0.04)
        }
        .clipShape(Circle())
        .padding(tier == .guest ? 0 : ringWidth + 1.5)
        .overlay { ring }
        .overlay(alignment: .bottomTrailing) { badge }
        .frame(width: size + (tier == .guest ? 0 : (ringWidth + 1.5) * 2), height: size + (tier == .guest ? 0 : (ringWidth + 1.5) * 2))
        .onAppear { spin = true }
        .accessibilityHidden(true)
    }

    private var ringWidth: CGFloat { max(2, size * 0.07) }

    @ViewBuilder private var ring: some View {
        switch tier {
        case .guest:
            Circle().strokeBorder(palette.border.opacity(0.7), lineWidth: 1)
        case .member:
            Circle().strokeBorder(palette.membership, lineWidth: ringWidth)
        case .premium:
            Circle()
                .strokeBorder(
                    AngularGradient(colors: [palette.membership, palette.membership.opacity(0.35), palette.textPrimary.opacity(0.9), palette.membership, palette.membership.opacity(0.35), palette.membership],
                                    center: .center),
                    lineWidth: ringWidth)
                .rotationEffect(.degrees(spin && !reduceMotion ? 360 : 0))
                .animation(reduceMotion ? nil : .linear(duration: 6).repeatForever(autoreverses: false), value: spin)
        }
    }

    @ViewBuilder private var badge: some View {
        if tier != .guest {
            Image(systemName: isPremium ? "crown.fill" : "star.fill")
                .font(.system(size: size * 0.24, weight: .bold))
                .foregroundStyle(palette.membershipText)
                .frame(width: size * 0.42, height: size * 0.42)
                .background(palette.membership, in: Circle())
                .overlay(Circle().strokeBorder(palette.background, lineWidth: max(1.5, size * 0.04)))
                .offset(x: size * 0.06, y: size * 0.06)
        }
    }

    private var isPremium: Bool { if case .premium = tier { true } else { false } }
}

/// Top-right avatar that opens Account. Added to each tab's root screen.
struct ProfileToolbar: ViewModifier {
    @Environment(AppModel.self) private var app
    @Environment(\.showProfile) private var showProfile

    func body(content: Content) -> some View {
        let tier = AvatarTier(membership: app.membership, plans: app.membershipPlans)
        content.toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showProfile() } label: { AvatarView(tier: tier) }
                    .buttonStyle(.plain)
                    .accessibilityLabel(tier.planName.map { "Account, \($0) member" } ?? "Account")
                    .accessibilityHint("Rewards, membership and settings")
            }
            .sharedBackgroundVisibility(.hidden)
        }
    }
}

extension View {
    func profileToolbar() -> some View { modifier(ProfileToolbar()) }
}

struct ShowProfileAction {
    let handler: () -> Void
    func callAsFunction() { handler() }
}

private struct ShowProfileKey: EnvironmentKey { static let defaultValue = ShowProfileAction {} }
extension EnvironmentValues {
    var showProfile: ShowProfileAction {
        get { self[ShowProfileKey.self] }
        set { self[ShowProfileKey.self] = newValue }
    }
}
