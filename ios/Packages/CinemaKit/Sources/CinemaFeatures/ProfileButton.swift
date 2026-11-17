import SwiftUI
import UIKit
import CinemaCore
import CinemaDesign

/// The customer's avatar: their photo if they added one, otherwise the person symbol.
/// Members get a ring in the operator's membership colour; the top plan (Premiere, Limitless and
/// the like) gets a slowly turning sheen on the ring. From 44pt up, a tag with the plan's short name
/// sits on the bottom of the ring, like a "LIVE" tag; smaller avatars show a small badge instead.
struct AvatarView: View {
    let tier: AvatarTier
    var size: CGFloat = 34
    var photo: UIImage?
    var tag: String?
    /// Shown instead of the person symbol when there's a name but no photo.
    var initials: String?
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var spin = false

    var body: some View {
        face
            .frame(width: size, height: size)
            .clipShape(Circle())
            .padding(tier == .guest ? 0 : ringWidth + gap)
            .overlay { ring }
            .overlay(alignment: .bottom) { if showsTag { tagView } }
            .overlay(alignment: .bottomTrailing) { if !showsTag { badge } }
            .padding(.bottom, showsTag ? tagHeight / 2 : 0)
            .onAppear { spin = true }
            .accessibilityHidden(true)
    }

    @ViewBuilder private var face: some View {
        if let photo {
            Image(uiImage: photo).resizable().scaledToFill()
        } else if let initials {
            ZStack {
                Circle().fill(palette.surfaceElevated)
                Text(initials)
                    .font(.system(size: size * 0.38, weight: .semibold, design: .rounded))
                    .foregroundStyle(tier == .guest ? palette.textPrimary : palette.membership)
                    .minimumScaleFactor(0.5)
            }
        } else {
            ZStack {
                Circle().fill(palette.surfaceElevated)
                Image(systemName: "person.fill")
                    .font(.system(size: size * 0.48, weight: .semibold))
                    .foregroundStyle(tier == .guest ? palette.textSecondary : palette.membership)
                    .offset(y: size * 0.04)
            }
        }
    }

    private var ringWidth: CGFloat { max(2, size * 0.06) }
    private var gap: CGFloat { max(1.5, size * 0.04) }
    private var showsTag: Bool { tier != .guest && size >= 44 && tag != nil }
    private var tagHeight: CGFloat { max(14, size * 0.3) }

    @ViewBuilder private var ring: some View {
        switch tier {
        case .guest:
            Circle().strokeBorder(palette.border.opacity(0.7), lineWidth: 1)
        case .member:
            Circle().strokeBorder(palette.membership, lineWidth: ringWidth)
        case .premium:
            Circle()
                .strokeBorder(
                    AngularGradient(colors: [palette.membership, palette.membership.opacity(0.45), palette.textPrimary.opacity(0.85), palette.membership, palette.membership.opacity(0.45), palette.membership],
                                    center: .center),
                    lineWidth: ringWidth)
                .rotationEffect(.degrees(spin && !reduceMotion ? 360 : 0))
                .animation(reduceMotion ? nil : .linear(duration: 8).repeatForever(autoreverses: false), value: spin)
        }
    }

    /// The plan's short name on a capsule in the membership colours, cut out from the page behind it.
    private var tagView: some View {
        HStack(spacing: 3) {
            if tier.isPremium { Image(systemName: "sparkle").font(.system(size: tagHeight * 0.5, weight: .bold)) }
            Text(tag ?? "")
                .font(.system(size: tagHeight * 0.56, weight: .heavy))
                .tracking(0.4)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .foregroundStyle(palette.membershipText)
        .padding(.horizontal, tagHeight * 0.45)
        .frame(height: tagHeight)
        .frame(maxWidth: size * 1.5)
        .background(palette.membership, in: Capsule())
        .overlay(Capsule().strokeBorder(palette.background, lineWidth: max(1.5, size * 0.03)))
        .fixedSize(horizontal: true, vertical: false)
        .offset(y: tagHeight / 2)
    }

    @ViewBuilder private var badge: some View {
        if tier != .guest {
            Image(systemName: tier.isPremium ? "sparkle" : "star.fill")
                .font(.system(size: size * 0.24, weight: .bold))
                .foregroundStyle(palette.membershipText)
                .frame(width: size * 0.42, height: size * 0.42)
                .background(palette.membership, in: Circle())
                .overlay(Circle().strokeBorder(palette.background, lineWidth: max(1.5, size * 0.04)))
                .offset(x: size * 0.06, y: size * 0.06)
        }
    }
}

/// The avatar as a button that opens Account. Used in each tab's bar and in the Home header.
struct ProfileButton: View {
    var size: CGFloat = 34
    @Environment(AppModel.self) private var app
    @Environment(\.showProfile) private var showProfile

    var body: some View {
        let tier = AvatarTier(membership: app.membership, plans: app.membershipPlans)
        Button { showProfile() } label: {
            AvatarView(tier: tier, size: size, photo: app.profileImage, tag: tier.tag(operatorWordmark: app.config.branding.wordmark), initials: app.profile.initials)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(tier.planName.map { "Account, \($0) member" } ?? "Account")
        .accessibilityHint("Rewards, membership and settings")
    }
}

/// Top-right avatar that opens Account. Added to each tab's root screen.
struct ProfileToolbar: ViewModifier {
    func body(content: Content) -> some View {
        content.toolbar {
            ToolbarItem(placement: .topBarTrailing) { ProfileButton() }
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
