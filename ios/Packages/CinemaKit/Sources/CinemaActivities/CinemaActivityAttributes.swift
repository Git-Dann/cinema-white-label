import ActivityKit
import Foundation
import CinemaCore

/// ActivityKit attributes for an upcoming screening. Shared by the app (which
/// starts and updates the activity) and the widget extension (which draws it).
public struct CinemaActivityAttributes: ActivityAttributes {
    public typealias ContentState = ScreeningActivityState
    public var content: ScreeningActivityContent

    public init(content: ScreeningActivityContent) { self.content = content }
}

/// Starts, updates and ends screening Live Activities locally. No push
/// notifications are needed: phase changes are scheduled from known times.
@MainActor
public final class LiveActivityController {
    public static let shared = LiveActivityController()
    private var timers: [String: Task<Void, Never>] = [:]

    public init() {}

    public var isEnabled: Bool { ActivityAuthorizationInfo().areActivitiesEnabled }

    /// Starts (or refreshes) an activity for a confirmed booking.
    public func start(for booking: Booking, config: TenantConfig, demo: Bool = false) {
        guard isEnabled, LiveActivityPolicy.shouldStart(booking, now: Date(), demo: demo) else { return }
        let content = ScreeningActivityContent(booking: booking, config: config)
        if let existing = Activity<CinemaActivityAttributes>.activities.first(where: { $0.attributes.content.bookingId == booking.id }) {
            scheduleUpdates(for: existing)
            return
        }
        let state = LiveActivityPolicy.state(for: content, now: Date())
        do {
            let activity = try Activity.request(
                attributes: CinemaActivityAttributes(content: content),
                content: .init(state: state, staleDate: LiveActivityPolicy.staleDate(for: content)),
                pushType: nil
            )
            scheduleUpdates(for: activity)
        } catch {
            // Live Activities are a convenience; the ticket is always in the app.
        }
    }

    /// Keeps running activities in step with the clock and ends finished or
    /// cancelled ones. Call on launch and when bookings change.
    public func reconcile(with bookings: [Booking]) {
        let confirmed = Set(bookings.filter { $0.status == .CONFIRMED }.map(\.id))
        for activity in Activity<CinemaActivityAttributes>.activities {
            let content = activity.attributes.content
            if !confirmed.contains(content.bookingId) || Date() >= LiveActivityPolicy.dismissalDate(for: content) {
                end(activity, immediately: true)
            } else {
                scheduleUpdates(for: activity)
            }
        }
    }

    public func endAll() {
        for activity in Activity<CinemaActivityAttributes>.activities { end(activity, immediately: true) }
    }

    private func end(_ activity: Activity<CinemaActivityAttributes>, immediately: Bool) {
        let content = activity.attributes.content
        timers[content.bookingId]?.cancel()
        timers[content.bookingId] = nil
        let final = LiveActivityPolicy.state(for: content, now: Date())
        Task {
            await activity.end(.init(state: final, staleDate: nil),
                               dismissalPolicy: immediately ? .immediate : .after(LiveActivityPolicy.dismissalDate(for: content)))
        }
    }

    private func scheduleUpdates(for activity: Activity<CinemaActivityAttributes>) {
        let content = activity.attributes.content
        timers[content.bookingId]?.cancel()
        timers[content.bookingId] = Task { [weak self] in
            while !Task.isCancelled {
                let now = Date()
                let state = LiveActivityPolicy.state(for: content, now: now)
                await activity.update(.init(state: state, staleDate: LiveActivityPolicy.staleDate(for: content)))
                if state.phase == .ended {
                    await MainActor.run { self?.end(activity, immediately: false) }
                    return
                }
                guard let next = LiveActivityPolicy.nextChange(startsAt: content.startsAt, endsAt: content.endsAt, now: now) else { return }
                try? await Task.sleep(for: .seconds(max(1, next.timeIntervalSince(now))))
            }
        }
    }
}
