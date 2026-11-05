import SwiftUI
import CoreMotion
import CinemaCore
import CinemaDesign

/// Device tilt for the rewards card, smoothed and kept small.
/// Runs only while a card is on screen (start/stop from onAppear/onDisappear),
/// at 30 Hz, and never when Reduce Motion is on. Device motion needs no
/// permission prompt.
@MainActor
@Observable
final class CardTilt {
    /// -1...1 on each axis, low-pass filtered.
    private(set) var x: Double = 0
    private(set) var y: Double = 0
    private let manager = CMMotionManager()
    private var users = 0

    func start() {
        users += 1
        guard users == 1, manager.isDeviceMotionAvailable else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 30.0
        manager.startDeviceMotionUpdates(to: .main) { [weak self] motion, _ in
            guard let g = motion?.gravity else { return }
            // Gravity gives a steady reading of how the phone is held; ease towards it.
            let tx = max(-1, min(1, g.x * 2.2))
            let ty = max(-1, min(1, (g.y + 0.6) * 2.2))
            // Updates are delivered on the main queue.
            MainActor.assumeIsolated {
                guard let self else { return }
                self.x += (tx - self.x) * 0.15
                self.y += (ty - self.y) * 0.15
            }
        }
    }

    func stop() {
        users = max(0, users - 1)
        guard users == 0 else { return }
        manager.stopDeviceMotionUpdates()
        x = 0; y = 0
    }
}

/// Points balance as a card: big number, what it is worth, progress to the next
/// reward. Tilts gently with the phone and catches a little light.
struct RewardsCard: View {
    let program: LoyaltyProgramInfo
    let onOpen: () -> Void
    @Environment(AppModel.self) private var app
    @Environment(\.palette) private var palette
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var tilt = CardTilt()

    private var summary: LoyaltySummary { app.loyalty }

    var body: some View {
        Button(action: onOpen) { card }
            .buttonStyle(PressableCardStyle())
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibilityText)
            .accessibilityHint("Shows your points history")
            .onAppear { if !reduceMotion { tilt.start() } }
            .onDisappear { tilt.stop() }
    }

    private var card: some View {
        let shape = RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous)
        let progress = summary.nextReward
        return VStack(alignment: .leading, spacing: Spacing.m) {
            HStack {
                Text(program.name.uppercased()).font(.caption.weight(.bold)).tracking(1.5)
                Spacer()
                Image(systemName: "sparkles").font(.headline)
            }
            .foregroundStyle(palette.actionPrimary)

            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(summary.points, format: .number)
                        .font(.system(size: 48, weight: .heavy)).monospacedDigit()
                        .contentTransition(.numericText())
                    Text("points").font(.headline).foregroundStyle(palette.textSecondary)
                }
                .foregroundStyle(palette.textPrimary)
                Text(summary.valueMinor.map { "Worth \(app.formatters.money($0)) off your next booking" } ?? program.summary(formatters: app.formatters))
                    .font(.subheadline).foregroundStyle(palette.textSecondary)
            }

            if let progress {
                VStack(alignment: .leading, spacing: Spacing.xs) {
                    ProgressView(value: progress.fraction).tint(palette.actionPrimary)
                    Text(progressText(progress)).font(.footnote).foregroundStyle(palette.textMuted)
                }
            }

            HStack {
                Text(program.summary(formatters: app.formatters)).font(.footnote).foregroundStyle(palette.textMuted).lineLimit(1).minimumScaleFactor(0.8)
                Spacer()
                HStack(spacing: 4) {
                    Text("History")
                    Image(systemName: "chevron.right").font(.caption.weight(.bold))
                }
                .font(.footnote.weight(.semibold)).foregroundStyle(palette.actionPrimary)
            }
        }
        .offset(x: tilt.x * 3, y: tilt.y * 2)
        .padding(Spacing.xl)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background {
            shape.fill(palette.surfaceElevated)
                .overlay {
                    // Accent glow that drifts towards the light.
                    RadialGradient(colors: [palette.actionPrimary.opacity(0.22), .clear],
                                   center: UnitPoint(x: 0.85 - tilt.x * 0.25, y: 0.1 - tilt.y * 0.15),
                                   startRadius: 4, endRadius: 280)
                        .clipShape(shape)
                }
                .overlay { holo.clipShape(shape) }
                .overlay { sparkles.offset(x: tilt.x * -6, y: tilt.y * -4).clipShape(shape) }
                .overlay(shape.strokeBorder(palette.actionPrimary.opacity(0.18)))
                .overlay {
                    // Edge that catches the light as the card tilts.
                    shape.strokeBorder(
                        LinearGradient(colors: [.clear, palette.textPrimary.opacity(0.45), .clear, palette.actionPrimary.opacity(0.5), .clear],
                                       startPoint: .topLeading,
                                       endPoint: UnitPoint(x: 0.6 + tilt.x * 0.4, y: 0.6 + tilt.y * 0.4)),
                        lineWidth: 1)
                    .opacity(reduceMotion ? 0.4 : 0.9)
                }
        }
        .rotation3DEffect(.degrees(tilt.y * -4), axis: (x: 1, y: 0, z: 0), perspective: 0.5)
        .rotation3DEffect(.degrees(tilt.x * 5), axis: (x: 0, y: 1, z: 0), perspective: 0.5)
    }

    /// Holographic foil: three hue-shifted copies of the brand accent drift against
    /// each other as the card tilts, with a soft light spot that follows the tilt.
    /// Rendered as one GPU layer so it stays cheap at 30 Hz.
    private var holo: some View {
        let mx = 0.5 + tilt.x * 0.45   // light position, like a cursor over the card
        let my = 0.4 + tilt.y * 0.45
        return ZStack {
            RadialGradient(colors: [palette.actionPrimary.opacity(0.55), .clear], center: UnitPoint(x: 1 - mx, y: my), startRadius: 0, endRadius: 220)
            RadialGradient(colors: [palette.actionPrimary.opacity(0.5), .clear], center: UnitPoint(x: mx, y: 1 - my), startRadius: 0, endRadius: 200)
                .hueRotation(.degrees(120 + tilt.x * 60))
            RadialGradient(colors: [palette.actionPrimary.opacity(0.45), .clear], center: UnitPoint(x: mx * 0.6 + 0.2, y: 0.9), startRadius: 0, endRadius: 240)
                .hueRotation(.degrees(240 + tilt.y * 60))
            // The light itself.
            RadialGradient(colors: [palette.textPrimary.opacity(0.14), .clear], center: UnitPoint(x: mx, y: my), startRadius: 0, endRadius: 160)
        }
        .opacity(reduceMotion ? 0.18 : 0.28)
        .blendMode(.plusLighter)
        .drawingGroup()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// A few fixed glints whose brightness follows the tilt, so they catch the light.
    private var sparkles: some View {
        GeometryReader { geo in
            ForEach(Self.glints.indices, id: \.self) { i in
                let g = Self.glints[i]
                let catchLight = max(0, 1 - abs((tilt.x * g.dx + tilt.y * g.dy) - g.phase) * 1.6)
                Image(systemName: "sparkle")
                    .font(.system(size: g.size, weight: .bold))
                    .foregroundStyle(palette.actionPrimary)
                    .opacity(reduceMotion ? 0.2 : 0.08 + catchLight * 0.7)
                    .scaleEffect(0.8 + catchLight * 0.35)
                    .position(x: geo.size.width * g.x, y: geo.size.height * g.y)
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private struct Glint { let x, y, size, dx, dy, phase: Double }
    /// Spread across the card, mostly to the right of the text, at varied sizes and
    /// angles so different glints light up as the phone moves.
    private static let glints: [Glint] = [
        .init(x: 0.78, y: 0.22, size: 14, dx: 1, dy: 0.4, phase: 0.2),
        .init(x: 0.90, y: 0.42, size: 9, dx: 0.6, dy: 1, phase: -0.3),
        .init(x: 0.66, y: 0.12, size: 7, dx: -0.8, dy: 0.5, phase: 0.4),
        .init(x: 0.86, y: 0.70, size: 11, dx: 1, dy: -0.6, phase: -0.1),
        .init(x: 0.72, y: 0.48, size: 6, dx: -0.5, dy: -1, phase: 0.1),
        .init(x: 0.95, y: 0.16, size: 6, dx: 0.3, dy: 0.9, phase: -0.5),
        .init(x: 0.58, y: 0.30, size: 5, dx: 0.9, dy: -0.3, phase: 0.6),
        .init(x: 0.80, y: 0.88, size: 7, dx: -1, dy: 0.2, phase: 0.3),
        .init(x: 0.50, y: 0.08, size: 5, dx: 0.2, dy: -0.8, phase: -0.2),
        .init(x: 0.93, y: 0.60, size: 5, dx: -0.4, dy: 0.7, phase: 0.5),
        .init(x: 0.40, y: 0.92, size: 6, dx: 0.7, dy: 0.7, phase: -0.4),
        .init(x: 0.64, y: 0.64, size: 8, dx: -0.9, dy: -0.4, phase: 0.0),
    ]

    private func progressText(_ p: RewardProgress) -> String {
        if p.canRedeem { return "Ready to use. \(p.pointsToGo) more for the next \(app.formatters.money(100)) off." }
        return "\(p.pointsToGo) points to your first \(app.formatters.money(100)) off."
    }

    private var accessibilityText: String {
        var parts = ["\(program.name): \(summary.points) points"]
        if let v = summary.valueMinor { parts.append("worth \(app.formatters.money(v)) off") }
        if let p = summary.nextReward { parts.append(progressText(p)) }
        return parts.joined(separator: ", ")
    }
}
