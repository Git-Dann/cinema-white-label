import SwiftUI
import CinemaCore
import CinemaDesign

// Membership: an inviting hero in Account, a full plans screen with paged plan
// cards, and a confirmation sheet. Colours come only from resolved theme tokens
// (membership / membershipText are contrast-checked as a pair).

// MARK: - Account hero

/// The membership entry point in Account: the member's card when they have one,
/// otherwise a promotional banner that opens the plans.
struct MembershipHero: View {
    /// Opens the plans. A plain button (not a list NavigationLink) so the card runs
    /// edge to edge with no disclosure arrow.
    let onOpen: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette

    var body: some View {
        if let m = app.membership, m.isActive {
            Button(action: onOpen) { MemberCard(membership: m) }
                .buttonStyle(PressableCardStyle())
                .accessibilityHint("Shows your benefits and renewal")
        } else if !app.membershipPlans.isEmpty {
            Button(action: onOpen) { promo }
                .buttonStyle(PressableCardStyle())
                .accessibilityHint("Shows membership plans")
        }
    }

    private var promo: some View {
        let featured = app.membershipPlans.first { $0.id == app.membershipPlans.featuredPlanID } ?? app.membershipPlans.first
        return VStack(alignment: .leading, spacing: Spacing.m) {
            Text("MEMBERSHIP").font(.caption.weight(.bold)).tracking(1.5).foregroundStyle(palette.membershipText.opacity(0.8))
            VStack(alignment: .leading, spacing: Spacing.xs) {
                Text("Go more.\nPay less.").font(.system(size: 34, weight: .heavy)).foregroundStyle(palette.membershipText)
                    .fixedSize(horizontal: false, vertical: true)
                if let cheapest = app.membershipPlans.cheapest {
                    Text("From \(cheapest.priceLabel(formatters: app.formatters)). No commitment.")
                        .font(.subheadline.weight(.medium)).foregroundStyle(palette.membershipText.opacity(0.85))
                }
            }
            if let featured {
                HStack(spacing: Spacing.m) {
                    ForEach(featured.entitlements.benefitItems.prefix(3), id: \.self) { b in
                        Label(b.title, systemImage: b.symbol)
                            .labelStyle(StackedLabelStyle())
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(palette.membershipText)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
            HStack {
                Text("See plans").font(.headline)
                Image(systemName: "arrow.right").font(.headline)
            }
            .foregroundStyle(palette.membership)
            .padding(.horizontal, Spacing.l)
            .frame(minHeight: Spacing.tap)
            .background(palette.membershipText, in: Capsule())
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background { MembershipSurface(cornerRadius: palette.cornerRadius.large) }
        .accessibilityElement(children: .combine)
    }
}

/// Cards that act as buttons: a slight press-in, no highlight colour.
struct PressableCardStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.2), value: configuration.isPressed)
            .contentShape(Rectangle())
    }
}

/// Icon above text, for compact benefit summaries.
private struct StackedLabelStyle: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            configuration.icon.font(.title3)
            configuration.title.lineLimit(2).fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// The rich membership background: brand membership colour with a soft light and a sheen.
struct MembershipSurface: View {
    let cornerRadius: CGFloat
    @Environment(\.palette) private var palette

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        shape.fill(palette.membership)
            .overlay {
                RadialGradient(colors: [palette.membershipText.opacity(0.22), .clear], center: .topLeading, startRadius: 10, endRadius: 360)
            }
            .overlay {
                LinearGradient(stops: [.init(color: .clear, location: 0.35), .init(color: palette.membershipText.opacity(0.10), location: 0.5), .init(color: .clear, location: 0.65)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
            }
            .overlay {
                // Large faint rings, like light through a projector gate. Sized and placed from
                // the card's own width, centred near the bottom-right corner, so they run off the
                // right and bottom edges at any card size and are cut only by the card's corners.
                GeometryReader { g in
                    let w = g.size.width
                    ZStack {
                        Circle().stroke(palette.membershipText.opacity(0.08), lineWidth: w * 0.075)
                            .frame(width: w * 0.78, height: w * 0.78)
                        Circle().stroke(palette.membershipText.opacity(0.06), lineWidth: w * 0.04)
                            .frame(width: w * 0.45, height: w * 0.45)
                    }
                    .position(x: w * 0.92, y: g.size.height - w * 0.1)
                }
                .accessibilityHidden(true)
            }
            // One clip for the whole card, so nothing is cut short inside it.
            .clipShape(shape)
    }
}

/// The member's card: looks like a physical membership card.
struct MemberCard: View {
    let membership: Membership
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(app.config.branding.wordmark.uppercased()).font(.caption.weight(.heavy)).tracking(2)
                Spacer()
                Image(systemName: "checkmark.seal.fill").font(.title3)
            }
            Spacer(minLength: Spacing.l)
            Text("MEMBER").font(.caption2.weight(.bold)).tracking(2).opacity(0.75)
            Text(membership.plan.name).font(.system(size: 30, weight: .heavy)).minimumScaleFactor(0.7).lineLimit(1)
            Spacer(minLength: Spacing.m)
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("VALID UNTIL").font(.caption2.weight(.bold)).tracking(1.5).opacity(0.75)
                    Text(app.formatters.longDate(membership.currentPeriodEnd, timeZone: app.config.tenant.timeZone)).font(.subheadline.weight(.semibold))
                }
                Spacer()
                Text(membership.plan.entitlements.benefitItems.first?.title ?? "").font(.subheadline.weight(.semibold))
            }
        }
        .foregroundStyle(palette.membershipText)
        .padding(Spacing.xl)
        .aspectRatio(1.586, contentMode: .fit)
        .frame(maxWidth: .infinity)
        .background { MembershipSurface(cornerRadius: palette.cornerRadius.large) }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(membership.plan.name) member, valid until \(app.formatters.longDate(membership.currentPeriodEnd, timeZone: app.config.tenant.timeZone))")
    }
}

// MARK: - Plans

/// Full-screen membership plans.
/// - Members: their card once, their benefits as a plain list, then any other plans as compact
///   rows on the normal surface (not a second gold card), with the renew button pinned below.
/// - Everyone else: the plans stacked cheapest first; tap one to choose it. The best-value plan
///   is the gold one. Nothing sits half off screen.
struct MembershipPlansView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @State private var selected: String?
    @State private var buying: MembershipPlan?

    private var plans: [MembershipPlan] { app.membershipPlans }
    private var memberPlan: MembershipPlan? { app.membership?.isActive == true ? app.membership?.plan : nil }
    /// The plan the button below acts on: the one tapped, else the member's own, else the best value.
    private var current: MembershipPlan? {
        plans.first { $0.id == selected }
            ?? memberPlan.flatMap { m in plans.first { $0.id == m.id } }
            ?? plans.first { $0.id == plans.featuredPlanID }
            ?? plans.first
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Spacing.section) {
                header
                if let m = app.membership, m.isActive {
                    MemberCard(membership: m).pagePadding()
                    benefits(m.plan)
                    otherPlans(m.plan)
                } else {
                    planList
                    howItWorks.pagePadding()
                }
                Text("Memberships don't renew automatically yet: buy each \(current?.interval == "year" ? "year" : "month") yourself. Discounts apply to bookings made while your membership is active.")
                    .font(.footnote).foregroundStyle(palette.textMuted).pagePadding()
            }
            .padding(.vertical, Spacing.l)
        }
        .scrollContentBackground(.hidden)
        .background(palette.background)
        .navigationTitle("Membership")
        .navigationBarTitleDisplayMode(.inline)
        .safeAreaInset(edge: .bottom) { cta }
        .sheet(item: $buying) { MembershipPurchaseSheet(plan: $0) }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: Spacing.xs) {
            Text("\(app.config.branding.wordmark.uppercased()) MEMBERSHIP").font(.caption.weight(.bold)).tracking(1.5).foregroundStyle(palette.membership)
            Text(memberPlan != nil ? "Your membership" : "More films.\nLess to pay.")
                .font(.system(size: 36, weight: .heavy)).foregroundStyle(palette.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Text(memberPlan != nil
                 ? "Your discounts apply automatically every time you book."
                 : "Discounts apply automatically every time you book. Choose the plan that fits how often you go.")
                .font(.body).foregroundStyle(palette.textSecondary)
        }
        .pagePadding()
    }

    // MARK: Member

    /// What the member gets, as a plain list on the normal card surface.
    private func benefits(_ plan: MembershipPlan) -> some View {
        let items = plan.entitlements.benefitItems
        return VStack(alignment: .leading, spacing: Spacing.m) {
            Text("Your benefits").font(.title3.weight(.bold)).foregroundStyle(palette.textPrimary)
            VStack(spacing: 0) {
                ForEach(Array(items.enumerated()), id: \.element) { i, b in
                    HStack(spacing: Spacing.s) {
                        Image(systemName: b.symbol)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(palette.membershipText)
                            .frame(width: 36, height: 36)
                            .background(palette.membership, in: Circle())
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(b.title).font(.headline).foregroundStyle(palette.textPrimary)
                            Text(b.detail).font(.footnote).foregroundStyle(palette.textSecondary)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.vertical, Spacing.s)
                    .accessibilityElement(children: .combine)
                    if i < items.count - 1 {
                        Rectangle().fill(palette.divider).frame(height: 1).padding(.leading, 36 + Spacing.s)
                    }
                }
            }
            .cardStyle(padding: Spacing.m)
        }
        .pagePadding()
    }

    /// The plans the member isn't on, compact and neutral. Tapping one shows in the button below
    /// what changing to it involves; tapping it again goes back to their own plan.
    @ViewBuilder private func otherPlans(_ mine: MembershipPlan) -> some View {
        let others = plans.others(than: mine)
        if !others.isEmpty {
            VStack(alignment: .leading, spacing: Spacing.m) {
                Text("Other plans").font(.title3.weight(.bold)).foregroundStyle(palette.textPrimary)
                ForEach(others) { p in
                    otherPlanRow(p, mine: mine)
                }
            }
            .pagePadding()
        }
    }

    private func otherPlanRow(_ p: MembershipPlan, mine: MembershipPlan) -> some View {
        let on = current?.id == p.id
        return Button {
            withAnimation(.snappy) { selected = on ? mine.id : p.id }
        } label: {
            HStack(alignment: .center, spacing: Spacing.m) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(p.name).font(.headline).foregroundStyle(palette.textPrimary)
                    Text(p.entitlements.benefitItems.prefix(2).map(\.title).joined(separator: " · "))
                        .font(.footnote).foregroundStyle(palette.textSecondary)
                        .lineLimit(2).fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: Spacing.s)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(p.priceLabel(formatters: app.formatters)).font(.subheadline.weight(.semibold)).foregroundStyle(palette.textPrimary)
                    HStack(spacing: 4) {
                        Text(on ? "Selected" : "See")
                        Image(systemName: on ? "checkmark.circle.fill" : "chevron.right")
                    }
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(palette.actionPrimary)
                }
            }
            .cardStyle(padding: Spacing.m)
            .overlay(RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous)
                .strokeBorder(on ? palette.actionPrimary : Color.clear, lineWidth: 2))
        }
        .buttonStyle(PressableCardStyle())
        .accessibilityAddTraits(on ? .isSelected : [])
        .accessibilityLabel("\(p.name), \(p.priceLabel(formatters: app.formatters))")
    }

    // MARK: Not a member

    /// Every plan, cheapest first, stacked so each is seen whole. Tap one to choose it.
    private var planList: some View {
        VStack(spacing: Spacing.m) {
            ForEach(plans.byPrice) { plan in
                Button {
                    withAnimation(.snappy) { selected = plan.id }
                } label: {
                    PlanCard(plan: plan, featured: plan.id == plans.featuredPlanID, isCurrent: false, selected: plan.id == current?.id)
                }
                .buttonStyle(PressableCardStyle())
            }
        }
        .pagePadding()
    }

    private var howItWorks: some View {
        VStack(alignment: .leading, spacing: Spacing.m) {
            Text("How it works").font(.title3.weight(.bold)).foregroundStyle(palette.textPrimary)
            step(1, "Join in seconds", "Pay once for the month. Your benefits start straight away.")
            step(2, "Book as usual", "Member prices show up automatically on tickets, fees and food.")
            step(3, "Stay in control", "Nothing renews behind your back. Buy another month when you want one.")
        }
        .cardStyle()
    }

    private func step(_ n: Int, _ title: String, _ detail: String) -> some View {
        HStack(alignment: .top, spacing: Spacing.s) {
            Text("\(n)").font(.subheadline.weight(.bold)).foregroundStyle(palette.membershipText)
                .frame(width: 28, height: 28).background(palette.membership, in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.headline).foregroundStyle(palette.textPrimary)
                Text(detail).font(.subheadline).foregroundStyle(palette.textSecondary).fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder private var cta: some View {
        if let plan = current {
            VStack(spacing: Spacing.xs) {
                switch MembershipOffer.offer(for: plan, current: app.membership) {
                case .join:
                    Button("Join \(plan.name) · \(plan.priceLabel(formatters: app.formatters))") { buying = plan }.buttonStyle(.cinemaPrimary)
                case .renew:
                    Button("Add another \(plan.interval == "year" ? "year" : "month") · \(app.formatters.money(plan.priceMinor))") { buying = plan }.buttonStyle(.cinemaPrimary)
                case .unavailable(let until):
                    Text("You can switch to \(plan.name) after your current membership ends on \(app.formatters.shortDate(until, timeZone: app.config.tenant.timeZone)).")
                        .font(.footnote).foregroundStyle(palette.textSecondary).multilineTextAlignment(.center)
                }
            }
            .bottomActionPadding()
            .background(.bar)
        }
    }
}

/// One plan as a tall card: name, price and benefits with symbols.
struct PlanCard: View {
    let plan: MembershipPlan
    let featured: Bool
    let isCurrent: Bool
    /// Shows a choice mark when the card is one of several to pick from; nil hides it.
    var selected: Bool? = nil
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette

    private var ink: Color { featured ? palette.membershipText : palette.textPrimary }
    private var inkSoft: Color { featured ? palette.membershipText.opacity(0.8) : palette.textSecondary }

    var body: some View {
        VStack(alignment: .leading, spacing: Spacing.l) {
            HStack {
                Text(plan.name.uppercased()).font(.subheadline.weight(.heavy)).tracking(1.5)
                Spacer()
                if isCurrent {
                    planTag("YOUR PLAN")
                } else if featured {
                    planTag("BEST VALUE")
                }
                if let selected {
                    Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                        .font(.title2)
                        .padding(.leading, Spacing.xs)
                        .accessibilityHidden(true)
                }
            }
            .foregroundStyle(ink)

            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(app.formatters.money(plan.priceMinor)).font(.system(size: 46, weight: .heavy)).monospacedDigit()
                    Text("/ \(plan.interval)").font(.headline).foregroundStyle(inkSoft)
                }
                .foregroundStyle(ink)
                if !plan.description.isEmpty {
                    Text(plan.description).font(.subheadline).foregroundStyle(inkSoft).lineLimit(3).fixedSize(horizontal: false, vertical: true)
                }
            }

            Rectangle().fill(ink.opacity(0.15)).frame(height: 1)

            VStack(alignment: .leading, spacing: Spacing.m) {
                ForEach(plan.entitlements.benefitItems, id: \.self) { b in
                    HStack(alignment: .top, spacing: Spacing.s) {
                        Image(systemName: b.symbol).font(.body.weight(.semibold))
                            .frame(width: 36, height: 36)
                            .background(ink.opacity(0.12), in: Circle())
                        VStack(alignment: .leading, spacing: 1) {
                            Text(b.title).font(.headline)
                            Text(b.detail).font(.footnote).foregroundStyle(inkSoft)
                        }
                    }
                    .foregroundStyle(ink)
                    .accessibilityElement(children: .combine)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background {
            if featured {
                MembershipSurface(cornerRadius: palette.cornerRadius.large)
            } else {
                RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous).fill(palette.surfaceElevated)
                    .overlay(RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous)
                        .strokeBorder(selected == true ? palette.membership : palette.membership.opacity(0.35), lineWidth: selected == true ? 2 : 1))
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("\(plan.name), \(plan.priceLabel(formatters: app.formatters))\(featured ? ", best value" : "")")
        .accessibilityAddTraits(selected == true ? .isSelected : [])
    }

    private func planTag(_ text: String) -> some View {
        Text(text).font(.caption2.weight(.heavy)).tracking(1)
            .padding(.horizontal, 10).padding(.vertical, 5)
            .foregroundStyle(featured ? palette.membership : palette.membershipText)
            .background(featured ? palette.membershipText : palette.membership, in: Capsule())
    }
}

// MARK: - Checkout

/// Confirms a membership purchase. Payments are simulated until a payment provider is configured.
struct MembershipPurchaseSheet: View {
    let plan: MembershipPlan
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false
    @State private var error: String?
    @State private var joined = false
    /// One key per sheet, so retrying the same tap after a network error is not charged twice.
    @State private var key = UUID().uuidString
    #if DEBUG
    @State private var simulateDecline = false
    #endif

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Spacing.l) {
                    PlanCard(plan: plan, featured: true, isCurrent: false)
                    DetailRows([
                        ("You pay today", app.formatters.money(plan.priceMinor)),
                        ("Covers", "One \(plan.interval), starting now"),
                        ("Renewal", "None. You choose when to buy again"),
                    ])
                    InfoBanner(.info, "Development build: payment is simulated and no money is taken.")
                    #if DEBUG
                    Toggle("Simulate a declined payment", isOn: $simulateDecline).cardStyle()
                    #endif
                    if let error { Text(error).foregroundStyle(palette.error) }
                }
                .pagePadding()
                .padding(.vertical, Spacing.l)
            }
            .scrollContentBackground(.hidden)
            .background(palette.background)
            .navigationTitle("Join \(plan.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(role: .cancel) { dismiss() }.tint(.primary) } }
            .safeAreaInset(edge: .bottom) {
                Button(busy ? "Paying…" : "Pay \(app.formatters.money(plan.priceMinor))") { Task { await buy() } }
                    .buttonStyle(.cinemaPrimary)
                    .disabled(busy)
                    .bottomActionPadding()
                    .background(.bar)
            }
            .sensoryFeedback(.success, trigger: joined)
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
            joined = true
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
