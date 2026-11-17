import SwiftUI
import PhotosUI
import UIKit
import CinemaCore
import CinemaDesign

/// Account, opened from the avatar: rewards, membership, appearance, favourite cinemas, help and legal.
/// Sign in with Apple and notifications are not shown until real.
struct AccountView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Environment(\.colorSchemeContrast) private var contrast
    @Environment(\.switchOperator) private var switchOperator
    @Environment(\.dismiss) private var dismiss
    @State private var showHistory = false
    @State private var showPlans = false

    /// Under the name: the plan for members, otherwise what's on file (or why to add it).
    private func subtitle(_ tier: AvatarTier) -> String {
        if let plan = tier.planName { return "\(plan) member" }
        if let email = app.profile.email { return email }
        return "Name, email and photo for your bookings"
    }

    var body: some View {
        @Bindable var store = app.configStore
        List {
            // Who you are, as Settings shows your Apple Account: avatar, name, and a way in to edit.
            Section {
                let tier = AvatarTier(membership: app.membership, plans: app.membershipPlans)
                NavigationLink { ProfileView() } label: {
                    HStack(spacing: Spacing.m) {
                        AvatarView(tier: tier, size: 60, photo: app.profileImage, tag: tier.tag(operatorWordmark: app.config.branding.wordmark), initials: app.profile.initials)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(app.profile.fullName ?? "Add your details")
                                .font(.title3.weight(.semibold))
                                .foregroundStyle(palette.textPrimary)
                            Text(subtitle(tier))
                                .font(.subheadline)
                                .foregroundStyle(palette.textSecondary)
                                .lineLimit(2)
                        }
                    }
                    .padding(.vertical, Spacing.xxs)
                }
                .accessibilityHint("Name, email, phone and photo")
            }
            if let program = app.loyalty.program {
                Section {
                    RewardsCard(program: program) { showHistory = true }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
            }
            if !app.membershipPlans.isEmpty || app.membership?.isActive == true {
                Section {
                    MembershipHero { showPlans = true }
                        .listRowInsets(EdgeInsets())
                        .listRowBackground(Color.clear)
                }
            }
            if app.config.allThemes.count > 1 {
                Section {
                    Picker("Theme", selection: $store.preferredThemeID) {
                        Text("Default (\(app.config.theme.name))").tag(ThemeID?.none)
                        ForEach(app.config.allThemes, id: \.themeId) { t in
                            Text(t.name).tag(ThemeID?.some(t.themeId))
                        }
                    }
                } header: { Text("Appearance") } footer: {
                    Text(contrast == .increased && app.config.allThemes.contains { $0.themeId == .highContrast }
                         ? "Increase Contrast is on, so High Contrast is being used."
                         : "Themes follow your device's light and dark setting unless the theme is designed for one appearance.")
                }
            }
            Section {
                if app.favouriteVenues.isEmpty { Text("Tap the house next to a cinema to add it here.").foregroundStyle(palette.textMuted) }
                ForEach(app.favouriteVenues) { Text($0.name) }
                // Shared Seatfold app only: back to the list of cinema operators.
                if let switchOperator {
                    Button {
                        dismiss()
                        switchOperator()
                    } label: { Label("Change cinema", systemImage: "arrow.left.arrow.right") }
                }
            } header: { Text("Your cinemas") } footer: {
                if switchOperator != nil { Text("You're booking with \(app.config.tenant.name). Your tickets stay saved if you change.") }
            }
            Section {
                Toggle("Share anonymous usage data", isOn: Binding(
                    get: { UserDefaults.standard.object(forKey: "analyticsEnabled") as? Bool ?? true },
                    set: { v in UserDefaults.standard.set(v, forKey: "analyticsEnabled"); Task { await app.analytics.setEnabled(v) } }
                ))
            } header: { Text("Privacy") } footer: {
                Text("Helps \(app.config.tenant.name) improve the app. No names, contact details or precise location are collected.")
            }
            Section("Help") {
                Link(destination: URL(string: "mailto:\(app.config.support.email)")!) { Label(app.config.support.email, systemImage: "envelope") }
                if let phone = app.config.support.phone, let url = URL(string: "tel:\(phone.replacingOccurrences(of: " ", with: ""))") {
                    Link(destination: url) { Label(phone, systemImage: "phone") }
                }
                if let s = app.config.support.url, let url = URL(string: s) { Link(destination: url) { Label("Help centre", systemImage: "questionmark.circle") } }
            }
            Section("Legal") {
                if let url = URL(string: app.config.legal.termsUrl) { Link("Terms of use", destination: url) }
                if let url = URL(string: app.config.legal.privacyUrl) { Link("Privacy notice", destination: url) }
            }
            Section {
                LabeledContent("Operator", value: app.config.legal.companyName)
                LabeledContent("Configuration", value: "v\(app.config.version) (\(app.configStore.source.rawValue))")
                if let reason = app.configStore.lastRejection {
                    Text("A newer configuration was rejected: \(reason)").font(.footnote).foregroundStyle(palette.warning)
                }
            } header: { Text("About") } footer: {
                // TMDB's terms ask apps using its data to say so (demo catalogue only).
                if (app.nowShowing + app.comingSoon).contains(where: { $0.poster?.attribution == "Image: TMDB" }) {
                    Text("Film data and images from TMDB. This product uses the TMDB API but is not endorsed or certified by TMDB.")
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(palette.background)
        .navigationTitle("Account")
        .navigationBarTitleDisplayMode(.inline)
        .listSectionSpacing(Spacing.l)
        .navigationDestination(isPresented: $showHistory) { PointsHistoryView() }
        .navigationDestination(isPresented: $showPlans) { MembershipPlansView() }
        .task { await app.loadAccount() }
        .refreshable { await app.loadAccount() }
    }
}

/// Points history, newest first.
struct PointsHistoryView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette

    var body: some View {
        List {
            if app.loyalty.history.isEmpty {
                Text("Book a film to start earning points.").foregroundStyle(palette.textMuted)
            }
            ForEach(app.loyalty.history) { e in
                HStack(alignment: .firstTextBaseline) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(e.title).foregroundStyle(palette.textPrimary)
                        Text("\(e.description) · \(app.formatters.shortDate(e.createdAt, timeZone: app.config.tenant.timeZone))")
                            .font(.footnote).foregroundStyle(palette.textMuted)
                    }
                    Spacer()
                    Text(e.points > 0 ? "+\(e.points)" : "\(e.points)")
                        .font(.body.monospacedDigit().weight(.semibold))
                        .foregroundStyle(e.points > 0 ? palette.success : palette.textSecondary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityLabel("\(e.title), \(abs(e.points)) points, \(e.description)")
            }
        }
        .scrollContentBackground(.hidden)
        .background(palette.background)
        .navigationTitle("Points history")
        .refreshable { await app.loadAccount() }
    }
}
