import SwiftUI
import CinemaCore
import CinemaDesign

/// Covers the app when the server says this version is too old to work (fleet/policy.json minimumVersion).
/// The decision and the words come from CinemaCore (`UpdatePrompt`); this view only shows them.
struct UpdateRequiredView: View {
    let prompt: UpdatePrompt
    let storeUrl: URL?
    @Environment(\.palette) private var palette
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(spacing: 20) {
            Spacer()
            Image(systemName: "arrow.down.app")
                .font(.system(size: 56, weight: .regular))
                .foregroundStyle(palette.actionPrimary)
                .accessibilityHidden(true)
            Text(prompt.title)
                .font(.title2.bold())
                .multilineTextAlignment(.center)
                .foregroundStyle(palette.textPrimary)
            Text(prompt.body)
                .font(.body)
                .multilineTextAlignment(.center)
                .foregroundStyle(palette.textSecondary)
            Spacer()
            if let storeUrl {
                Button("Update in the App Store") { openURL(storeUrl) }
                    .buttonStyle(PrimaryButtonStyle())
            } else {
                Text("Open the App Store or TestFlight to update.")
                    .font(.footnote)
                    .foregroundStyle(palette.textSecondary)
            }
        }
        .padding(24)
        .frame(maxWidth: 480)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(palette.background.ignoresSafeArea())
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
    }
}

extension View {
    /// The fleet update prompts: a one-off alert for a new version, and a blocking cover
    /// when this version is below the minimum. Offline never blocks.
    func updatePrompts(_ app: AppModel) -> some View {
        modifier(UpdatePromptsModifier(app: app))
    }
}

private struct UpdatePromptsModifier: ViewModifier {
    let app: AppModel
    @Environment(\.openURL) private var openURL

    func body(content: Content) -> some View {
        let prompt = app.updatePrompt
        content
            .overlay {
                if case .require(let s) = prompt {
                    UpdateRequiredView(prompt: prompt, storeUrl: s.storeUrl)
                }
            }
            .alert(prompt.title, isPresented: Binding(get: { if case .suggest = app.updatePrompt { true } else { false } }, set: { if !$0 { app.dismissUpdate() } })) {
                if case .suggest(let s) = prompt, let url = s.storeUrl {
                    Button("Update") {
                        app.dismissUpdate()
                        openURL(url)
                    }
                }
                Button("Not now", role: .cancel) { app.dismissUpdate() }
            } message: {
                Text(prompt.body)
            }
    }
}
