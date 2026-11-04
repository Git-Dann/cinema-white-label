import SwiftUI
import CinemaCore
import CinemaDesign

/// Account: appearance, favourite cinemas, help and legal. Sign in with Apple,
/// memberships and notifications arrive in Phase 3 and are not shown until real.
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
    }
}
