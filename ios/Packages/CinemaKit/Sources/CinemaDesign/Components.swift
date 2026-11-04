import SwiftUI
import CoreImage.CIFilterBuiltins
import CinemaCore

// MARK: - Section header ("Featured ›" + subtitle, as in the design references)

public struct SectionHeader<Destination: View>: View {
    let title: String
    let subtitle: String?
    let destination: Destination?
    @Environment(\.palette) private var palette
    @Environment(\.headingWeight) private var headingWeight

    public init(_ title: String, subtitle: String? = nil, @ViewBuilder destination: () -> Destination) {
        self.title = title; self.subtitle = subtitle; self.destination = destination()
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            if let destination {
                NavigationLink { destination } label: { titleRow(chevron: true) }
                    .buttonStyle(.plain)
                    .accessibilityHint("Shows all")
            } else {
                titleRow(chevron: false)
            }
            if let subtitle {
                Text(subtitle).font(.subheadline).foregroundStyle(palette.textMuted)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private func titleRow(chevron: Bool) -> some View {
        HStack(spacing: 6) {
            Text(title).font(.title2.weight(headingWeight)).foregroundStyle(palette.textPrimary)
            if chevron { Image(systemName: "chevron.right").font(.title3.weight(.semibold)).foregroundStyle(palette.textMuted) }
        }
    }
}

public extension SectionHeader where Destination == EmptyView {
    init(_ title: String, subtitle: String? = nil) {
        self.title = title; self.subtitle = subtitle; self.destination = nil
    }
}

// MARK: - Poster card

public struct PosterCard: View {
    public enum Size { case small, medium, large
        var width: CGFloat { switch self { case .small: 116; case .medium: 140; case .large: 260 } }
    }
    let film: Film
    let size: Size
    let caption: String?
    @Environment(\.palette) private var palette

    public init(film: Film, size: Size = .medium, caption: String? = nil) {
        self.film = film; self.size = size; self.caption = caption
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ArtworkImage(film.poster, fallbackTitle: film.title)
                .aspectRatio(2 / 3, contentMode: .fit)
                .frame(width: size.width)
                .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.medium, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: palette.cornerRadius.medium, style: .continuous).strokeBorder(.white.opacity(0.08)))
                .shadow(color: .black.opacity(0.35), radius: 10, y: 6)
            if let caption {
                Text(caption).font(.footnote).foregroundStyle(palette.textMuted).lineLimit(1)
                    .frame(width: size.width, alignment: .leading)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel([film.title, film.certificate == "TBC" ? nil : "Certificate \(film.certificate)", caption].compactMap { $0 }.joined(separator: ", "))
        .accessibilityAddTraits(.isButton)
    }
}

/// Large featured card: tall poster with title and two-line synopsis below.
public struct FeaturedFilmCard: View {
    let film: Film
    let width: CGFloat
    @Environment(\.palette) private var palette

    public init(film: Film, width: CGFloat) { self.film = film; self.width = width }

    public var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            ArtworkImage(film.poster, fallbackTitle: film.title)
                .aspectRatio(2 / 3, contentMode: .fit)
                .frame(width: width)
                .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.large, style: .continuous))
                .overlay(alignment: .topTrailing) {
                    if let badge = film.formats.first(where: { $0 != "2D" }) { FormatBadge(badge).padding(12) }
                }
                .shadow(color: .black.opacity(0.4), radius: 16, y: 10)
            VStack(alignment: .leading, spacing: 4) {
                Text(film.title).font(.headline).foregroundStyle(palette.textPrimary)
                Text(film.synopsis).font(.subheadline).foregroundStyle(palette.textMuted).lineLimit(2)
            }
            .padding(.horizontal, 6)
            .frame(width: width, alignment: .leading)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
    }
}

/// Three posters fanned out, used for collections and promotions.
public struct FannedPosterStack: View {
    let films: [Film]
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.palette) private var palette

    public init(films: [Film]) { self.films = Array(films.prefix(3)) }

    public var body: some View {
        ZStack {
            ForEach(Array(films.enumerated()), id: \.element.id) { index, film in
                let offset = CGFloat(index - 1)
                ArtworkImage(film.poster)
                    .aspectRatio(2 / 3, contentMode: .fit)
                    .frame(width: index == 1 ? 150 : 130)
                    .clipShape(RoundedRectangle(cornerRadius: palette.cornerRadius.medium, style: .continuous))
                    .shadow(color: .black.opacity(0.45), radius: 12, y: 8)
                    .rotationEffect(.degrees(Double(offset) * 8))
                    .offset(x: offset * 110, y: abs(offset) * 22)
                    .zIndex(index == 1 ? 1 : 0)
            }
        }
        .frame(height: 260)
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
    }
}

public struct FormatBadge: View {
    let text: String
    public init(_ text: String) { self.text = text }
    public var body: some View {
        Text(text.uppercased())
            .font(.caption2.weight(.heavy))
            .padding(.horizontal, 8).padding(.vertical, 4)
            .background(.ultraThinMaterial, in: Capsule())
            .foregroundStyle(.white)
            .environment(\.colorScheme, .dark)
    }
}

// MARK: - Buttons

/// Primary pill button using the operator accent with guaranteed-contrast label.
public struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.palette) private var palette
    @Environment(\.isEnabled) private var isEnabled
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 20)
            .foregroundStyle(palette.actionPrimaryText)
            .background(palette.actionPrimary.opacity(isEnabled ? 1 : 0.4), in: Capsule())
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.snappy(duration: 0.15), value: configuration.isPressed)
            .contentShape(Capsule())
    }
}

/// Secondary glass pill, matching the "+ Watchlist" style in the references.
public struct GlassPillButtonStyle: ButtonStyle {
    @Environment(\.palette) private var palette
    public init() {}
    public func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity, minHeight: 52)
            .padding(.horizontal, 20)
            .foregroundStyle(palette.textPrimary)
            .glassEffect(.regular.interactive(), in: Capsule())
            .opacity(configuration.isPressed ? 0.85 : 1)
            .contentShape(Capsule())
    }
}

public extension ButtonStyle where Self == PrimaryButtonStyle { static var cinemaPrimary: PrimaryButtonStyle { .init() } }
public extension ButtonStyle where Self == GlassPillButtonStyle { static var cinemaGlass: GlassPillButtonStyle { .init() } }

// MARK: - Small pieces

/// Label/value pair used in the horizontal facts row on film details.
public struct StatItem: View {
    let icon: String
    let label: String
    let value: String
    let spokenValue: String?
    @Environment(\.palette) private var palette

    public init(icon: String, label: String, value: String, spokenValue: String? = nil) {
        self.icon = icon; self.label = label; self.value = value; self.spokenValue = spokenValue
    }

    public var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(label, systemImage: icon).font(.subheadline).foregroundStyle(palette.textMuted)
            Text(value).font(.title3.weight(.bold)).foregroundStyle(palette.textPrimary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label): \(spokenValue ?? value)")
    }
}

public struct InfoBanner: View {
    public enum Kind { case info, warning, error, success }
    let kind: Kind
    let text: String
    let actionTitle: String?
    let action: (() -> Void)?
    @Environment(\.palette) private var palette

    public init(_ kind: Kind, _ text: String, actionTitle: String? = nil, action: (() -> Void)? = nil) {
        self.kind = kind; self.text = text; self.actionTitle = actionTitle; self.action = action
    }

    public var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: icon).foregroundStyle(tint).accessibilityHidden(true)
            Text(text).font(.subheadline).foregroundStyle(palette.textPrimary).frame(maxWidth: .infinity, alignment: .leading)
            if let actionTitle, let action {
                Button(actionTitle, action: action).font(.subheadline.weight(.semibold)).foregroundStyle(tint)
            }
        }
        .padding(14)
        .background(palette.surface, in: RoundedRectangle(cornerRadius: palette.cornerRadius.small, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: palette.cornerRadius.small, style: .continuous).strokeBorder(tint.opacity(0.6)))
        .accessibilityElement(children: .combine)
    }

    private var icon: String {
        switch kind { case .info: "info.circle.fill"; case .warning: "exclamationmark.triangle.fill"; case .error: "xmark.octagon.fill"; case .success: "checkmark.circle.fill" }
    }
    private var tint: Color {
        switch kind { case .info: palette.focus; case .warning: palette.warning; case .error: palette.error; case .success: palette.success }
    }
}

public struct LoadingView: View {
    let text: String
    @Environment(\.palette) private var palette
    public init(_ text: String = "Loading…") { self.text = text }
    public var body: some View {
        VStack(spacing: 12) { ProgressView(); Text(text).font(.subheadline).foregroundStyle(palette.textMuted) }
            .frame(maxWidth: .infinity, minHeight: 200)
    }
}

/// QR code for admission. Rendered at native resolution with no interpolation.
public struct QRCodeView: View {
    let payload: String
    public init(_ payload: String) { self.payload = payload }

    public var body: some View {
        if let image = Self.render(payload) {
            Image(uiImage: image)
                .interpolation(.none)
                .resizable()
                .scaledToFit()
                .padding(14)
                .background(.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                .accessibilityLabel("Admission QR code")
        }
    }

    static func render(_ text: String) -> UIImage? {
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(text.utf8)
        filter.correctionLevel = "M"
        guard let output = filter.outputImage?.transformed(by: CGAffineTransform(scaleX: 10, y: 10)),
              let cg = CIContext().createCGImage(output, from: output.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

public struct CertificateBadge: View {
    let certificate: String
    public init(_ certificate: String) { self.certificate = certificate }
    public var body: some View {
        Text(certificate)
            .font(.caption.weight(.bold))
            .padding(.horizontal, 6).padding(.vertical, 2)
            .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(lineWidth: 1))
            .accessibilityLabel("Certificate \(certificate)")
    }
}
