import SwiftUI
import UIKit
import CinemaCore
import CinemaDesign

/// The shared Seatfold app: the customer picks a cinema operator, and the whole app then
/// takes on that operator's theme. Choosing another operator is one tap from Account.
/// The logic (search, the remembered choice, the saved theme) is in CinemaCore; this is layout.
public struct SharedAppView: View {
    let directory: any DirectoryService
    let choices: OperatorChoiceStore
    let makeApp: @MainActor (TenantConfig) -> AppModel
    /// API base URL, for operator logos in the picker.
    let mediaBaseURL: URL
    @State private var app: AppModel?
    @State private var welcome: Bool
    /// Set when the customer chose "Find cinemas near me" on the welcome screen.
    @State private var startNearby = false

    public init(directory: any DirectoryService, choices: OperatorChoiceStore, mediaBaseURL: URL, makeApp: @escaping @MainActor (TenantConfig) -> AppModel) {
        self.directory = directory
        self.choices = choices
        self.mediaBaseURL = mediaBaseURL
        self.makeApp = makeApp
        // Reopen the last operator straight away, in their theme, even offline.
        _app = State(initialValue: choices.slug.flatMap(choices.seed(for:)).map(makeApp))
        _welcome = State(initialValue: !choices.hasSeenWelcome)
    }

    public var body: some View {
        if let app {
            RootView(app: app)
                .id(app.config.tenant.slug)
                .environment(\.switchOperator, SwitchOperatorAction {
                    choices.clear()
                    self.app = nil
                })
        } else if welcome {
            WelcomeView(
                findNearby: { finishWelcome(nearby: true) },
                search: { finishWelcome(nearby: false) }
            )
        } else {
            OperatorPickerView(directory: directory, startNearby: startNearby) { config in
                try choices.choose(config)
                app = makeApp(config)
            }
            .environment(\.mediaBaseURL, mediaBaseURL)
        }
    }
}

extension SharedAppView {
    fileprivate func finishWelcome(nearby: Bool) {
        choices.markWelcomeSeen()
        startNearby = nearby
        withAnimation(.smooth) { welcome = false }
    }
}

/// First launch of the shared app: what it is, in three lines, then straight to finding a cinema.
struct WelcomeView: View {
    let findNearby: () -> Void
    let search: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 24)
            SeatfoldMark()
                .frame(width: 64, height: 64)
                .accessibilityHidden(true)
                .padding(.bottom, 28)
            Text("Your local cinema, in one app")
                .font(.largeTitle.bold())
                .foregroundStyle(palette.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 32)
            VStack(alignment: .leading, spacing: 24) {
                point("mappin.and.ellipse", "Find cinemas near you", "Independent and local cinemas, nearest first.")
                point("paintpalette", "Each cinema looks like itself", "Pick one and the app takes on its brand, films and offers.")
                point("ticket", "Your tickets stay with you", "Change cinema any time. Tickets for each one are kept.")
            }
            Spacer(minLength: 32)
            VStack(spacing: 12) {
                Button("Find cinemas near me", action: findNearby)
                    .buttonStyle(PrimaryButtonStyle())
                Button("Search by town or postcode", action: search)
                    .font(.headline)
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .tint(palette.textPrimary)
            }
        }
        .padding(.horizontal, 28)
        .padding(.bottom, 16)
        .frame(maxWidth: 520)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(palette.background.ignoresSafeArea())
    }

    private func point(_ symbol: String, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: 16) {
            Image(systemName: symbol)
                .font(.title2)
                .foregroundStyle(palette.actionPrimary)
                .frame(width: 32)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline).foregroundStyle(palette.textPrimary)
                Text(detail).font(.subheadline).foregroundStyle(palette.textSecondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

/// The Seatfold mark (three seats and a screen block), drawn in the theme's action colour.
struct SeatfoldMark: View {
    @Environment(\.palette) private var palette
    var body: some View {
        GeometryReader { g in
            let u = g.size.width / 24
            ZStack(alignment: .topLeading) {
                Circle().frame(width: 9 * u, height: 9 * u).offset(x: 2 * u, y: 2 * u)
                Circle().frame(width: 9 * u, height: 9 * u).offset(x: 13 * u, y: 2 * u)
                Circle().frame(width: 9 * u, height: 9 * u).offset(x: 2 * u, y: 13 * u)
                RoundedRectangle(cornerRadius: 1.5 * u, style: .continuous).frame(width: 9 * u, height: 9 * u).offset(x: 13 * u, y: 13 * u)
            }
            .foregroundStyle(palette.actionPrimary)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

/// Set only in the shared app; Account shows "Change cinema" when it is.
public struct SwitchOperatorAction {
    let handler: () -> Void
    public func callAsFunction() { handler() }
}

private struct SwitchOperatorKey: EnvironmentKey { static let defaultValue: SwitchOperatorAction? = nil }
extension EnvironmentValues {
    var switchOperator: SwitchOperatorAction? {
        get { self[SwitchOperatorKey.self] }
        set { self[SwitchOperatorKey.self] = newValue }
    }
}

struct OperatorPickerView: View {
    let directory: any DirectoryService
    /// Ask for the location straight away (the customer chose "near me" on the welcome screen).
    var startNearby = false
    let onChosen: (TenantConfig) throws -> Void
    @Environment(\.palette) private var palette
    @State private var query = ""
    @State private var entries: [DirectoryEntry] = []
    @State private var loading = true
    @State private var failed = false
    @State private var opening: String?
    @State private var problem: String?
    @State private var location = LocationProvider()
    @State private var coordinate: (Double, Double)?
    @State private var locating = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Button {
                        Task { await useLocation() }
                    } label: {
                        Label(coordinate == nil ? "Show cinemas near me" : "Nearest first", systemImage: coordinate == nil ? "location" : "location.fill")
                    }
                    .disabled(coordinate != nil || locating)
                }
                if failed {
                    Section {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Couldn't load cinemas").font(.headline)
                            Text("Check your connection and try again.").foregroundStyle(palette.textSecondary)
                            Button("Try again") { Task { await load() } }
                        }
                    }
                } else if !loading && entries.isEmpty {
                    Section { Text("No cinemas match \u{201C}\(query)\u{201D}.").foregroundStyle(palette.textSecondary) }
                } else {
                    Section(coordinate == nil ? "Cinemas" : "Nearest first") {
                        ForEach(entries) { e in
                            Button { Task { await open(e) } } label: { row(e) }
                                .disabled(opening != nil)
                        }
                    }
                }
            }
            .overlay { if loading && entries.isEmpty { ProgressView() } }
            .navigationTitle("Choose your cinema")
            .searchable(text: $query, prompt: "Cinema, town or postcode")
            .task(id: query) {
                // Wait for typing to pause before searching.
                if !query.isEmpty { try? await Task.sleep(for: .milliseconds(300)) }
                await load()
            }
            .task { if startNearby { await useLocation() } }
            .alert("Couldn't open this cinema", isPresented: Binding(get: { problem != nil }, set: { if !$0 { problem = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(problem ?? "") }
        }
    }

    private func row(_ e: DirectoryEntry) -> some View {
        HStack(spacing: 14) {
            OperatorLogo(entry: e)
            VStack(alignment: .leading, spacing: 2) {
                Text(e.name).font(.headline).foregroundStyle(palette.textPrimary)
                Text(e.summary(distance: CinemasView.distance)).font(.subheadline).foregroundStyle(palette.textSecondary)
            }
            Spacer()
            if opening == e.slug { ProgressView() } else { Image(systemName: "chevron.right").foregroundStyle(palette.textMuted).accessibilityHidden(true) }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens \(e.name)")
    }

    private func load() async {
        loading = true
        defer { loading = false }
        do {
            entries = try await directory.operators(query: query, latitude: coordinate?.0, longitude: coordinate?.1)
            failed = false
        } catch is CancellationError {
        } catch {
            failed = entries.isEmpty
        }
    }

    private func useLocation() async {
        locating = true
        defer { locating = false }
        guard let loc = await location.currentLocation() else { return }
        coordinate = (loc.coordinate.latitude, loc.coordinate.longitude)
        await load()
    }

    private func open(_ e: DirectoryEntry) async {
        opening = e.slug
        defer { opening = nil }
        do {
            try onChosen(try await directory.config(slug: e.slug))
        } catch {
            problem = "Check your connection and try again."
        }
    }
}

/// The operator's logo on a neutral tile, so every brand sits on the same footing. While it loads,
/// or when there is none, the tile shows the operator's initial with their accent as a ring.
struct OperatorLogo: View {
    let entry: DirectoryEntry
    @Environment(\.colorScheme) private var scheme
    @Environment(\.mediaBaseURL) private var base
    @Environment(\.palette) private var palette
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 12, style: .continuous).fill(palette.surfaceElevated)
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFit()
                    .padding(6)
                    .transition(.opacity)
            } else {
                Text(entry.monogram)
                    .font(.title3.weight(.bold))
                    .foregroundStyle(palette.textPrimary)
                    .frame(width: 34, height: 34)
                    .overlay(Circle().strokeBorder(Color(hex: scheme == .dark ? entry.accent.dark : entry.accent.light), lineWidth: 2))
            }
        }
        .frame(width: 56, height: 56)
        .accessibilityHidden(true)
        .task(id: scheme) {
            guard let url = entry.logoURL(isDark: scheme == .dark, base: base) else { image = nil; return }
            let loaded = await ImagePipeline.shared.image(for: url)
            withAnimation(.easeOut(duration: 0.2)) { image = loaded }
        }
    }
}
