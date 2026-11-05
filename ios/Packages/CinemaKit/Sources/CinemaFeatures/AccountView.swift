import SwiftUI
import CinemaCore
import CinemaDesign

/// Account: rewards, membership, appearance, favourite cinemas, help and legal.
/// Sign in with Apple and notifications are not shown until real.
struct AccountView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Environment(\.colorSchemeContrast) private var contrast

    var body: some View {
        @Bindable var store = app.configStore
        List {
            Section {
                HStack {
                    BrandLogo(config: app.config).frame(height: 36)
                    Spacer()
                }
                .listRowBackground(Color.clear)
            }
            if let program = app.loyalty.program {
                Section {
                    NavigationLink { PointsHistoryView() } label: {
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(app.loyalty.points) points").font(.title3.weight(.bold)).foregroundStyle(palette.textPrimary)
                                Text(app.loyalty.valueMinor.map { "Worth \(app.formatters.money($0)) off a booking" } ?? program.summary(formatters: app.formatters))
                                    .font(.subheadline).foregroundStyle(palette.textSecondary)
                            }
                            Spacer()
                            Image(systemName: "star.circle.fill").font(.title).foregroundStyle(palette.actionPrimary).accessibilityHidden(true)
                        }
                    }
                } header: { Text(program.name) } footer: { Text(program.summary(formatters: app.formatters)) }
            }
            if !app.membershipPlans.isEmpty || app.membership?.isActive == true {
                Section {
                    MembershipHero()
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
            Section("Your cinemas") {
                if app.favouriteVenues.isEmpty { Text("Tap the house next to a cinema to add it here.").foregroundStyle(palette.textMuted) }
                ForEach(app.favouriteVenues) { Text($0.name) }
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
            Section("About") {
                LabeledContent("Operator", value: app.config.legal.companyName)
                LabeledContent("Configuration", value: "v\(app.config.version) (\(app.configStore.source.rawValue))")
                if let reason = app.configStore.lastRejection {
                    Text("A newer configuration was rejected: \(reason)").font(.footnote).foregroundStyle(palette.warning)
                }
            }
        }
        .scrollContentBackground(.hidden)
        .background(palette.background)
        .navigationTitle("Account")
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
