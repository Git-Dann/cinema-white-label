import ActivityKit
import SwiftUI
import WidgetKit
import CinemaCore
import CinemaDesign

// Live Activity and widget views. These render outside the app, so they use
// the operator accent from the content plus system materials rather than the
// full theme palette, and always stay legible on the Lock Screen.

struct PhaseIcon: View {
    let phase: ScreeningPhase

    private var symbol: String {
        switch phase {
        case .upcoming: "ticket.fill"
        case .doorsOpen: "door.left.hand.open"
        case .startingSoon: "timer"
        case .started: "film.fill"
        case .ended: "checkmark.circle.fill"
        }
    }

    var body: some View {
        Image(systemName: symbol).accessibilityHidden(true)
    }
}

/// Countdown text that updates by itself (no app wake-ups needed).
struct StartCountdown: View {
    let startsAt: Date
    let phase: ScreeningPhase
    var body: some View {
        if phase == .upcoming || phase == .doorsOpen || phase == .startingSoon {
            Text(timerInterval: Date()...max(Date(), startsAt), countsDown: true)
                .monospacedDigit()
        } else {
            Text(phase == .started ? "Now" : "Ended")
        }
    }
}

public struct ScreeningLockScreenView: View {
    let content: ScreeningActivityContent
    let state: ScreeningActivityState

    public init(content: ScreeningActivityContent, state: ScreeningActivityState) { self.content = content; self.state = state }

    public var body: some View {
        let accent = Color(hex: content.accentHex)
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                Label(content.wordmark, systemImage: "film").font(.caption.weight(.semibold)).foregroundStyle(accent)
                Text(state.headline).font(.headline).lineLimit(1)
                Text(state.detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 2) {
                Text("Starts").font(.caption2).foregroundStyle(.secondary)
                StartCountdown(startsAt: content.startsAt, phase: state.phase).font(.title2.weight(.bold)).foregroundStyle(accent)
                Text(content.startsAt, style: .time).font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(16)
        .activityBackgroundTint(Color.black.opacity(0.55))
        .activitySystemActionForegroundColor(accent)
        .widgetURL(URL(string: content.deepLink))
        .accessibilityElement(children: .combine)
    }
}

/// Live Activity configuration (Lock Screen + Dynamic Island), used by the widget extension.
public struct ScreeningLiveActivity: Widget {
    public init() {}

    public var body: some WidgetConfiguration {
        ActivityConfiguration(for: CinemaActivityAttributes.self) { context in
            ScreeningLockScreenView(content: context.attributes.content, state: context.state)
        } dynamicIsland: { context in
            let c = context.attributes.content
            let accent = Color(hex: c.accentHex)
            return DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    Label(c.auditoriumName, systemImage: "film").font(.caption).foregroundStyle(accent)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    StartCountdown(startsAt: c.startsAt, phase: context.state.phase).font(.headline).foregroundStyle(accent)
                }
                DynamicIslandExpandedRegion(.center) {
                    Text(c.filmTitle).font(.headline).lineLimit(1)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        PhaseIcon(phase: context.state.phase).foregroundStyle(accent)
                        Text(context.state.detail).font(.subheadline).foregroundStyle(.secondary).lineLimit(2)
                        Spacer()
                        Text("Seats \(c.seatSummary)").font(.subheadline.weight(.semibold))
                    }
                }
            } compactLeading: {
                PhaseIcon(phase: context.state.phase).foregroundStyle(accent)
            } compactTrailing: {
                StartCountdown(startsAt: c.startsAt, phase: context.state.phase).font(.caption.weight(.semibold)).frame(maxWidth: 52)
            } minimal: {
                PhaseIcon(phase: context.state.phase).foregroundStyle(accent)
            }
            .widgetURL(URL(string: c.deepLink))
            .keylineTint(accent)
        }
    }
}

// MARK: - Next ticket widget

public struct NextTicketEntry: TimelineEntry {
    public let date: Date
    public let snapshot: WidgetSnapshot?
}

public struct NextTicketProvider: TimelineProvider {
    let store: WidgetSnapshotStore
    let fallback: @Sendable (Date) -> WidgetSnapshot

    public init(store: WidgetSnapshotStore, fallback: @escaping @Sendable (Date) -> WidgetSnapshot) {
        self.store = store; self.fallback = fallback
    }

    /// Real data when the app has shared it; otherwise labelled demo content.
    private func snapshot(now: Date) -> WidgetSnapshot { store.load() ?? fallback(now) }

    public func placeholder(in context: Context) -> NextTicketEntry { NextTicketEntry(date: Date(), snapshot: fallback(Date())) }

    public func getSnapshot(in context: Context, completion: @escaping (NextTicketEntry) -> Void) {
        completion(NextTicketEntry(date: Date(), snapshot: context.isPreview ? fallback(Date()) : snapshot(now: Date())))
    }

    public func getTimeline(in context: Context, completion: @escaping (Timeline<NextTicketEntry>) -> Void) {
        let now = Date()
        let snap = snapshot(now: now)
        let entries = snap.timelineDates(now: now).map { NextTicketEntry(date: $0, snapshot: snap) }
        completion(Timeline(entries: entries, policy: .after(now.addingTimeInterval(3600))))
    }
}

public struct NextTicketWidgetView: View {
    let entry: NextTicketEntry
    @Environment(\.widgetFamily) private var family

    public init(entry: NextTicketEntry) { self.entry = entry }

    public var body: some View {
        let snap = entry.snapshot
        let accent = Color(hex: snap?.accentHex ?? "#2DD4BF")
        Group {
            if let next = snap?.next {
                switch family {
                case .accessoryRectangular:
                    VStack(alignment: .leading) {
                        Text(next.filmTitle).font(.headline).lineLimit(1)
                        Text(next.startsAt, style: .time) + Text(" · \(next.auditoriumName)")
                        Text("Seats \(next.seatSummary)").font(.caption)
                    }
                case .accessoryInline:
                    Text("\(next.filmTitle) at ") + Text(next.startsAt, style: .time)
                default:
                    VStack(alignment: .leading, spacing: 4) {
                        HStack {
                            Label(snap?.wordmark ?? "", systemImage: "ticket.fill").font(.caption.weight(.semibold)).foregroundStyle(accent)
                            Spacer()
                            if snap?.isDemo == true { Text("DEMO").font(.caption2.weight(.heavy)).foregroundStyle(.secondary) }
                        }
                        Spacer(minLength: 0)
                        Text(next.filmTitle).font(.headline).lineLimit(2)
                        Text(next.startsAt, style: .relative).font(.subheadline.weight(.semibold)).foregroundStyle(accent)
                        Text("\(next.auditoriumName) · Seats \(next.seatSummary)").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        if family == .systemMedium {
                            Text(next.venueName).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    Label(snap?.wordmark ?? "Tickets", systemImage: "ticket").font(.caption.weight(.semibold)).foregroundStyle(accent)
                    Spacer(minLength: 0)
                    Text("No upcoming tickets").font(.headline)
                    Text("Book a film and it will appear here.").font(.caption).foregroundStyle(.secondary)
                }
            }
        }
        .containerBackground(for: .widget) { Color.black.opacity(0.85) }
        .widgetURL(URL(string: snap?.deepLink ?? ""))
    }
}
