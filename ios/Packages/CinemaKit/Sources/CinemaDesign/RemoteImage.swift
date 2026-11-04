import SwiftUI
import UIKit
import CinemaCore

/// Small in-memory + URLCache image pipeline. Requests the smallest server
/// rendition that covers the rendered size at the screen scale.
public actor ImagePipeline {
    public static let shared = ImagePipeline()
    private let cache = NSCache<NSURL, UIImage>()
    private var inFlight: [URL: Task<UIImage?, Never>] = [:]
    private let session: URLSession

    public init() {
        let config = URLSessionConfiguration.default
        config.urlCache = URLCache(memoryCapacity: 32 << 20, diskCapacity: 256 << 20)
        config.requestCachePolicy = .returnCacheDataElseLoad
        session = URLSession(configuration: config)
        cache.totalCostLimit = 96 << 20
    }

    public func image(for url: URL) async -> UIImage? {
        if let hit = cache.object(forKey: url as NSURL) { return hit }
        if let task = inFlight[url] { return await task.value }
        let session = self.session
        let task = Task<UIImage?, Never> {
            guard let (data, response) = try? await session.data(from: url),
                  (response as? HTTPURLResponse)?.statusCode == 200,
                  let image = UIImage(data: data) else { return nil }
            return await image.byPreparingForDisplay() ?? image
        }
        inFlight[url] = task
        let image = await task.value
        inFlight[url] = nil
        if let image { cache.setObject(image, forKey: url as NSURL, cost: Int(image.size.width * image.size.height * image.scale * image.scale * 4)) }
        return image
    }
}

/// Artwork view that fills its frame using the asset's focal point, so
/// operator-chosen subjects stay visible when cropped. Never stretches.
public struct ArtworkImage: View {
    let ref: ImageRef?
    let accessibilityLabel: String?
    @Environment(\.mediaBaseURL) private var base
    @Environment(\.displayScale) private var displayScale
    @Environment(\.palette) private var palette
    @State private var image: UIImage?

    public init(_ ref: ImageRef?, accessibilityLabel: String? = nil) {
        self.ref = ref
        self.accessibilityLabel = accessibilityLabel
    }

    public var body: some View {
        GeometryReader { geo in
            ZStack {
                placeholder
                if let image {
                    Image(uiImage: image)
                        .resizable()
                        .aspectRatio(contentMode: .fill)
                        .frame(width: geo.size.width, height: geo.size.height, alignment: alignment(for: geo.size, image: image.size))
                        .clipped()
                        .transition(.opacity)
                }
            }
            .task(id: ref?.url) {
                guard let ref, let url = ref.url(forPixelWidth: geo.size.width * displayScale, base: base) else { return }
                let loaded = await ImagePipeline.shared.image(for: url)
                withAnimation(.easeOut(duration: 0.2)) { image = loaded }
            }
        }
        .accessibilityElement()
        .accessibilityLabel(accessibilityLabel ?? "")
        .accessibilityHidden(accessibilityLabel == nil)
    }

    private var placeholder: some View {
        Rectangle().fill(ref?.dominantColor.map { Color(hex: $0) } ?? palette.surfaceElevated)
    }

    /// Converts a focal point into a frame alignment so aspect-fill crops around it.
    private func alignment(for frame: CGSize, image: CGSize) -> Alignment {
        guard let fp = ref?.focalPoint, image.width > 0, image.height > 0 else { return .center }
        return Alignment(horizontal: fp.x < 0.4 ? .leading : fp.x > 0.6 ? .trailing : .center,
                         vertical: fp.y < 0.4 ? .top : fp.y > 0.6 ? .bottom : .center)
    }
}

/// Operator logo loaded from tenant config, falling back to the wordmark text.
public struct BrandLogo: View {
    let config: TenantConfig
    @Environment(\.colorScheme) private var scheme
    @Environment(\.mediaBaseURL) private var base
    @Environment(\.palette) private var palette
    @State private var image: UIImage?

    public init(config: TenantConfig) { self.config = config }

    public var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().scaledToFit()
            } else {
                Text(config.branding.wordmark).font(.title2.weight(.bold)).foregroundStyle(palette.textPrimary)
            }
        }
        .accessibilityLabel(config.tenant.name)
        .task(id: scheme) {
            let path = scheme == .dark ? config.branding.logoDarkUrl : config.branding.logoLightUrl
            guard let path, let url = URL(string: path, relativeTo: base)?.absoluteURL else { return }
            image = await ImagePipeline.shared.image(for: url)
        }
    }
}
