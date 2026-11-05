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
            if !app.membershipPlans.isEmpty || app.membership != nil {
                MembershipSection()
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
            Section("Favourite cinemas") {
                if app.favouriteVenues.isEmpty { Text("Tap the star next to a cinema to add it here.").foregroundStyle(palette.textMuted) }
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

/// Current membership (with renewal) or the plans on sale.
struct MembershipSection: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @State private var buying: MembershipPlan?

    var body: some View {
        Section {
            if let m = app.membership, m.isActive {
                VStack(alignment: .leading, spacing: 4) {
                    Label(m.plan.name, systemImage: "checkmark.seal.fill").font(.headline).foregroundStyle(palette.textPrimary)
                    Text("Active until \(app.formatters.longDate(m.currentPeriodEnd, timeZone: app.config.tenant.timeZone))")
                        .font(.subheadline).foregroundStyle(palette.textSecondary)
                    Text(m.plan.entitlements.benefits.joined(separator: " · ")).font(.footnote).foregroundStyle(palette.textMuted)
                }
                .accessibilityElement(children: .combine)
            }
            ForEach(app.membershipPlans) { plan in
                let offer = MembershipOffer.offer(for: plan, current: app.membership)
                VStack(alignment: .leading, spacing: 6) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(plan.name).font(.headline).foregroundStyle(palette.textPrimary)
                        Spacer()
                        Text(plan.priceLabel(formatters: app.formatters)).font(.subheadline.monospacedDigit()).foregroundStyle(palette.textSecondary)
                    }
                    ForEach(plan.entitlements.benefits, id: \.self) { b in
                        Label(b, systemImage: "checkmark").font(.subheadline).foregroundStyle(palette.textSecondary)
                    }
                    switch offer {
                    case .join:
                        Button("Join \(plan.name)") { buying = plan }.buttonStyle(.borderedProminent).tint(palette.actionPrimary)
                    case .renew:
                        Button("Renew for another \(plan.interval == "year" ? "year" : "month")") { buying = plan }.buttonStyle(.bordered)
                    case .unavailable(let until):
                        Text("Available after your current membership ends on \(app.formatters.shortDate(until, timeZone: app.config.tenant.timeZone)).")
                            .font(.footnote).foregroundStyle(palette.textMuted)
                    }
                }
                .padding(.vertical, 4)
            }
        } header: {
            Text("Membership")
        } footer: {
            Text("Memberships renew manually: buy each \(app.membershipPlans.first?.interval == "year" ? "year" : "month") yourself. Automatic renewal arrives with card payments.")
        }
        .sheet(item: $buying) { MembershipPurchaseSheet(plan: $0) }
    }
}

/// Confirms a membership purchase. Payments are simulated until a payment provider is configured.
struct MembershipPurchaseSheet: View {
    let plan: MembershipPlan
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var error: String?
    /// One key per sheet, so retrying the same tap after a network error is not charged twice.
    @State private var key = UUID().uuidString
    #if DEBUG
    @State private var simulateDecline = false
    #endif

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(plan.description).foregroundStyle(palette.textSecondary)
                    ForEach(plan.entitlements.benefits, id: \.self) { Label($0, systemImage: "checkmark") }
                }
                Section {
                    LabeledContent("Price", value: plan.priceLabel(formatters: app.formatters))
                    LabeledContent("Renewal", value: "Manual")
                }
                Section {
                    InfoBanner(.info, "Development build: payment is simulated and no money is taken.").listRowBackground(Color.clear)
                    #if DEBUG
                    Toggle("Simulate a declined payment", isOn: $simulateDecline)
                    #endif
                    if let error { Text(error).foregroundStyle(palette.error) }
                }
            }
            .scrollContentBackground(.hidden)
            .background(palette.background)
            .navigationTitle(plan.name)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
            .safeAreaInset(edge: .bottom) {
                Button(busy ? "Paying…" : "Pay \(app.formatters.money(plan.priceMinor))") { Task { await buy() } }
                    .buttonStyle(.cinemaPrimary)
                    .disabled(busy)
                    .padding(16)
            }
        }
    }

    private func buy() async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            #if DEBUG
            try await app.buyMembership(plan, simulateDecline: simulateDecline, idempotencyKey: key)
            #else
            try await app.buyMembership(plan, idempotencyKey: key)
            #endif
            AccessibilityNotification.Announcement("You're a \(plan.name) member").post()
            dismiss()
        } catch let e as APIError {
            error = e.message
            // A decline is a final answer for this key; a new attempt gets a new one.
            if e.code == .paymentDeclined { key = UUID().uuidString }
        } catch {
            self.error = "Something went wrong. Try again."
        }
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
