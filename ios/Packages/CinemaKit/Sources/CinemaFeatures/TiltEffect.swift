import SwiftUI

/// A gentle 3D tilt that follows the phone (via `CardTilt`), with a gloss that
/// slides across and an edge that catches the light. Used for film posters.
/// Motion runs only while the view is on screen and never with Reduce Motion.
struct TiltEffect: ViewModifier {
    let cornerRadius: CGFloat
    let maxDegrees: Double
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var tilt = CardTilt()

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        content
            .overlay {
                // Gloss: a soft band of light that moves with the tilt.
                LinearGradient(stops: [.init(color: .clear, location: 0.22 + tilt.x * 0.25),
                                       .init(color: .white.opacity(0.16), location: 0.4 + tilt.x * 0.25),
                                       .init(color: .clear, location: 0.58 + tilt.x * 0.25)],
                               startPoint: .topLeading, endPoint: .bottomTrailing)
                    .blendMode(.plusLighter)
                    .clipShape(shape)
                    .allowsHitTesting(false)
            }
            .overlay {
                // Edge that catches the light.
                shape.strokeBorder(
                    LinearGradient(colors: [.white.opacity(0.08), .white.opacity(0.5), .white.opacity(0.06), .white.opacity(0.3), .white.opacity(0.08)],
                                   startPoint: .topLeading,
                                   endPoint: UnitPoint(x: 0.6 + tilt.x * 0.4, y: 0.6 + tilt.y * 0.4)),
                    lineWidth: 1)
                .allowsHitTesting(false)
            }
            // The shadow falls away from the light.
            .shadow(color: .black.opacity(0.5), radius: 26, x: tilt.x * -8, y: 16 - tilt.y * 4)
            .rotation3DEffect(.degrees(tilt.y * -maxDegrees * 0.8), axis: (x: 1, y: 0, z: 0), perspective: 0.5)
            .rotation3DEffect(.degrees(tilt.x * maxDegrees), axis: (x: 0, y: 1, z: 0), perspective: 0.5)
            .onAppear { if !reduceMotion { tilt.start() } }
            .onDisappear { tilt.stop() }
    }
}

extension View {
    func tiltEffect(cornerRadius: CGFloat, maxDegrees: Double = 6) -> some View {
        modifier(TiltEffect(cornerRadius: cornerRadius, maxDegrees: maxDegrees))
    }
}
