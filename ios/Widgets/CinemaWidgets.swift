import SwiftUI
import WidgetKit
import CinemaActivities
import CinemaCore

/// Widget extension: the "next ticket" widget and the screening Live Activity.
@main
struct CinemaWidgetsBundle: WidgetBundle {
    var body: some Widget {
        NextTicketWidget()
        ScreeningLiveActivity()
    }
}

struct NextTicketWidget: Widget {
    private static let info = Bundle.main.infoDictionary ?? [:]
    private static let slug = info["TenantSlug"] as? String ?? "northlight"
    private static let appGroup = info["AppGroup"] as? String ?? ""

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NextTicket", provider: NextTicketProvider(
            store: WidgetSnapshotStore(suiteName: Self.appGroup),
            fallback: { now in
                // Labelled demo content when the app hasn't shared data (no App Group, or demo build).
                guard let config = BundledConfig.load(tenantSlug: Self.slug) else {
                    return WidgetSnapshot(generatedAt: now, wordmark: "Cinema", accentHex: "#2DD4BF", deepLink: "", next: nil, upcomingCount: 0, isDemo: true)
                }
                return WidgetSnapshot.demo(config: config, now: now)
            }
        )) { entry in
            NextTicketWidgetView(entry: entry)
        }
        .configurationDisplayName("Next ticket")
        .description("Your next film: time, screen and seats.")
        .supportedFamilies([.systemSmall, .systemMedium, .accessoryRectangular, .accessoryInline])
    }
}
