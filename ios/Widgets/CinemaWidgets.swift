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
    private static let appGroup = info["AppGroup"] as? String ?? ""
    /// A branded app's operator, or the one chosen in the shared Seatfold app (saved in the App Group).
    private static var slug: String {
        (info["TenantSlug"] as? String).flatMap { $0.isEmpty ? nil : $0 }
            ?? UserDefaults(suiteName: appGroup)?.string(forKey: "seatfold.operator")
            ?? "northlight"
    }

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "NextTicket", provider: NextTicketProvider(
            store: WidgetSnapshotStore(suiteName: Self.appGroup),
            fallback: { now in
                // Labelled demo content when the app hasn't shared data (no App Group, or demo build).
                guard let config = BundledConfig.load(tenantSlug: Self.slug) else { return .empty(now: now) }
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
