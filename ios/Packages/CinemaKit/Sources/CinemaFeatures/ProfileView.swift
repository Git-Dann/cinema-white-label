import SwiftUI
import PhotosUI
import UIKit
import CinemaCore
import CinemaDesign

/// The customer's own details, laid out the way Settings shows an Apple Account: a large avatar
/// with Edit under it, then grouped rows with the label on the left and the value on the right.
/// Rules (what's valid, what's saved, where it goes) live in CinemaCore's `CustomerProfile`.
struct ProfileView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @State private var draft = CustomerProfile.empty
    @State private var loaded = false
    @State private var photoItem: PhotosPickerItem?
    @State private var confirmRemove = false
    @State private var triedToSave = false
    @FocusState private var focus: CustomerProfile.Field?

    private var problems: [CustomerProfile.Field: String] { draft.problems() }
    private var changed: Bool { draft.details != app.profile.details }
    private var operatorName: String { app.config.tenant.name }

    var body: some View {
        List {
            Section {
                header
                    .frame(maxWidth: .infinity)
                    .listRowBackground(Color.clear)
                    .listRowInsets(EdgeInsets(top: 0, leading: 0, bottom: Spacing.xs, trailing: 0))
            }

            Section("Name") {
                field("First name", \.givenName, .givenName, content: .givenName)
                field("Last name", \.familyName, .familyName, content: .familyName)
            }

            Section {
                field("Email", \.email, .email, content: .emailAddress, keyboard: .emailAddress, prompt: "name@example.com")
                field("Mobile", \.phone, .phone, content: .telephoneNumber, keyboard: .phonePad, prompt: "Optional")
            } header: {
                Text("Contact")
            } footer: {
                Text("\(operatorName) uses these for booking confirmations and receipts.")
            }

            Section {
                Toggle("Offers and news by email", isOn: $draft.marketingOptIn)
                    .tint(palette.actionPrimary)
                    .disabled(draft.tidied().email == nil && !draft.marketingOptIn)
            } footer: {
                if let p = problems[.marketingOptIn], triedToSave || draft.marketingOptIn {
                    Text(p).foregroundStyle(palette.error)
                } else {
                    Text("\(operatorName) may email you about films and offers. Turn this off any time.")
                }
            }

            if let note = app.profileSyncProblem {
                Section { Label(note, systemImage: "icloud.slash").font(.footnote).foregroundStyle(palette.textSecondary) }
            }

            Section {
                Button("Remove My Details", role: .destructive) { confirmRemove = true }
                    .disabled(app.profile.isEmpty && app.profileImage == nil)
            } footer: {
                Text("Removes your name, email, phone and photo from this phone and from \(operatorName). Your tickets and points stay. Your photo never leaves this phone.")
            }
        }
        .scrollContentBackground(.hidden)
        .background(palette.background)
        .navigationTitle("Profile")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button("Done") { Task { await save() } }
                    .disabled(!changed)
            }
        }
        .onAppear {
            guard !loaded else { return }
            draft = app.profile
            loaded = true
        }
        // Leaving with valid changes keeps them, as Settings does.
        .onDisappear { if changed && problems.isEmpty { Task { await app.saveProfile(draft) } } }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                    try? app.setProfilePhoto(image)
                }
                photoItem = nil
            }
        }
        .confirmationDialog("Remove your details?", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove My Details", role: .destructive) {
                Task {
                    await app.removeProfile()
                    draft = .empty
                }
            }
        } message: {
            Text("Your tickets and points stay.")
        }
    }

    private var header: some View {
        let tier = AvatarTier(membership: app.membership, plans: app.membershipPlans)
        return VStack(spacing: Spacing.xs) {
            PhotosPicker(selection: $photoItem, matching: .images) {
                AvatarView(tier: tier, size: 96, photo: app.profileImage, tag: tier.tag(operatorWordmark: app.config.branding.wordmark), initials: draft.initials)
            }
            .buttonStyle(.plain)
            .accessibilityLabel(app.profileImage == nil ? "Add a photo" : "Change your photo")

            Menu {
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Label(app.profileImage == nil ? "Choose Photo" : "Choose New Photo", systemImage: "photo.on.rectangle")
                }
                if app.profileImage != nil {
                    Button("Remove Photo", systemImage: "trash", role: .destructive) { try? app.setProfilePhoto(nil) }
                }
            } label: {
                Text("Edit").font(.subheadline.weight(.semibold))
            }
            .tint(palette.actionPrimary)

            Text(draft.fullName ?? "Your name")
                .font(.title2.weight(.bold))
                .foregroundStyle(draft.fullName == nil ? palette.textMuted : palette.textPrimary)
                .padding(.top, Spacing.xxs)
            if let plan = tier.planName {
                Text("\(plan) member").font(.subheadline).foregroundStyle(palette.textSecondary)
            }
        }
    }

    /// One row: label on the left, the value on the right, and what to fix underneath.
    private func field(_ label: String, _ path: WritableKeyPath<CustomerProfile, String?>, _ key: CustomerProfile.Field,
                       content: UITextContentType, keyboard: UIKeyboardType = .default, prompt: String = "Optional") -> some View {
        let text = Binding<String>(get: { draft[keyPath: path] ?? "" }, set: { draft[keyPath: path] = $0 })
        let problem = (triedToSave || focus != key) && !(draft[keyPath: path] ?? "").isEmpty ? problems[key] : nil
        return VStack(alignment: .leading, spacing: 4) {
            LabeledContent(label) {
                TextField(label, text: text, prompt: Text(prompt).foregroundStyle(palette.textMuted))
                    .multilineTextAlignment(.trailing)
                    .textContentType(content)
                    .keyboardType(keyboard)
                    .textInputAutocapitalization(key == .email ? .never : .words)
                    .autocorrectionDisabled(key == .email || key == .phone)
                    .focused($focus, equals: key)
                    .submitLabel(.done)
                    .onSubmit { Task { await save() } }
                    .foregroundStyle(palette.textPrimary)
            }
            if let problem {
                Text(problem).font(.footnote).foregroundStyle(palette.error)
            }
        }
    }

    private func save() async {
        triedToSave = true
        guard problems.isEmpty else { return }
        focus = nil
        if await app.saveProfile(draft) { draft = app.profile; triedToSave = false }
    }
}
