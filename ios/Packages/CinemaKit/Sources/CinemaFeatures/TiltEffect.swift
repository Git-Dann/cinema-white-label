import SwiftUI
import CoreMotion
import CinemaDesign

/// Reads device motion on demand (no callback), so the tilt can be sampled once
/// per display frame and eased with real elapsed time. That keeps it smooth at
/// 120 Hz on ProMotion screens, instead of stepping at the sensor rate.
@MainActor
final class TiltSampler {
    private let manager = CMMotionManager()
    private var x = 0.0, y = 0.0
    private var last: Date?

    func start() {
        guard manager.isDeviceMotionAvailable, !manager.isDeviceMotionActive else { return }
        manager.deviceMotionUpdateInterval = 1.0 / 60.0
        manager.startDeviceMotionUpdates()
    }

    func stop() {
        manager.stopDeviceMotionUpdates()
        x = 0; y = 0; last = nil
    }

    /// Current tilt, -1...1 on each axis, eased towards the latest reading.
    func sample(at date: Date) -> (x: Double, y: Double) {
        guard let g = manager.deviceMotion?.gravity else { return (x, y) }
        let tx = max(-1, min(1, g.x * 2.2))
        let ty = max(-1, min(1, (g.y + 0.6) * 2.2))
        let dt = last.map { min(0.1, max(0, date.timeIntervalSince($0))) } ?? 0
        last = date
        // Frame-rate independent easing with a ~90 ms time constant: responsive, never jittery.
        let k = 1 - exp(-dt / 0.09)
        x += (tx - x) * k
        y += (ty - y) * k
        return (x, y)
    }
}

/// A gentle 3D tilt that follows the phone, with a holographic sheen and a gloss
/// that slide across and an edge that catches the light. Used for film posters.
///
/// Everything that moves is a transform (rotation or offset) over layers whose
/// content never changes, so each frame is composited on the GPU and nothing is
/// redrawn or re-blurred. Motion runs only while on screen and never with Reduce Motion.
struct TiltEffect: ViewModifier {
    let cornerRadius: CGFloat
    let maxDegrees: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.palette) private var palette
    @State private var sampler = TiltSampler()
    @State private var visible = false

    func body(content: Content) -> some View {
        TimelineView(.animation(paused: reduceMotion || !visible)) { context in
            let t = (reduceMotion || !visible) ? (x: 0.0, y: 0.0) : sampler.sample(at: context.date)
            tilted(content, x: t.x, y: t.y)
        }
        .onAppear {
            visible = true
            if !reduceMotion { sampler.start() }
        }
        .onDisappear {
            visible = false
            sampler.stop()
        }
        .onChange(of: reduceMotion) { _, reduced in
            if reduced { sampler.stop() } else if visible { sampler.start() }
        }
    }

    private func tilted(_ content: Content, x: Double, y: Double) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        return content
            .overlay {
                GeometryReader { geo in
                    let w = geo.size.width, h = geo.size.height
                    ZStack {
                        // Holographic foil: a faint band of brand-tinted hues.
                        LinearGradient(stops: [.init(color: .clear, location: 0.3),
                                               .init(color: palette.actionPrimary.opacity(0.5), location: 0.42),
                                               .init(color: palette.actionPrimary.opacity(0.5), location: 0.5),
                                               .init(color: palette.actionPrimary.opacity(0.5), location: 0.58),
                                               .init(color: .clear, location: 0.7)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing)
                            .hueRotation(.degrees(-40))
                            .overlay {
                                LinearGradient(stops: [.init(color: .clear, location: 0.4),
                                                       .init(color: palette.actionPrimary.opacity(0.45), location: 0.52),
                                                       .init(color: .clear, location: 0.64)],
                                               startPoint: .topLeading, endPoint: .bottomTrailing)
                                    .hueRotation(.degrees(140))
                            }
                            .frame(width: w * 3, height: h * 3)
                            .offset(x: x * w * 0.55, y: y * h * 0.35)
                            .opacity(0.22)
                        // Gloss: a soft band of white light, moving a little faster than the foil.
                        LinearGradient(stops: [.init(color: .clear, location: 0.42),
                                               .init(color: .white.opacity(0.18), location: 0.5),
                                               .init(color: .clear, location: 0.58)],
                                       startPoint: .topLeading, endPoint: .bottomTrailing)
                            .frame(width: w * 3, height: h * 3)
                            .offset(x: x * w * 0.8, y: y * h * 0.5)
                    }
                    .frame(width: w, height: h)
                    .blendMode(.plusLighter)
                }
                .clipShape(shape)
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            .overlay {
                // Edge that catches the light: a fixed highlight, slid under a 1 pt ring.
                GeometryReader { geo in
                    LinearGradient(colors: [.white.opacity(0.08), .white.opacity(0.55), .white.opacity(0.08)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing)
                        .frame(width: geo.size.width * 2, height: geo.size.height * 2)
                        .offset(x: (x - 0.5) * geo.size.width * 0.5, y: (y - 0.5) * geo.size.height * 0.5)
                }
                .mask(shape.strokeBorder(lineWidth: 1))
                .allowsHitTesting(false)
                .accessibilityHidden(true)
            }
            // Shadow drawn once on its own layer and only moved, so it is never re-blurred.
            .background {
                // Inset well inside the poster so the card casting the shadow never
                // peeks out at the edges as the poster tilts; only the soft shadow shows.
                shape.fill(.black)
                    .padding(16)
                    .shadow(color: .black.opacity(0.6), radius: 28, y: 18)
                    .offset(x: x * -6, y: y * -3)
            }
            .rotation3DEffect(.degrees(y * -maxDegrees * 0.8), axis: (x: 1, y: 0, z: 0), perspective: 0.5)
            .rotation3DEffect(.degrees(x * maxDegrees), axis: (x: 0, y: 1, z: 0), perspective: 0.5)
    }
}

extension View {
    func tiltEffect(cornerRadius: CGFloat, maxDegrees: Double = 6) -> some View {
        modifier(TiltEffect(cornerRadius: cornerRadius, maxDegrees: maxDegrees))
    }
}
