import Foundation
import WidgetKit
import CinemaActivities
import CinemaCore

extension AppModel {
    /// Called when a booking is confirmed: starts the screening Live Activity.
    func bookingConfirmed(_ booking: Booking) {
        LiveActivityController.shared.start(for: booking, config: config, demo: isDemo)
        syncSystemSurfaces()
    }

    /// Keeps Live Activities and the widget in step with the customer's bookings.
    func syncSystemSurfaces() {
        LiveActivityController.shared.reconcile(with: tickets.bookings)
        var snapshot = WidgetSnapshot.make(bookings: tickets.bookings, config: config, now: Date())
        snapshot.isDemo = isDemo
        if widgetStore.save(snapshot) {
            WidgetCenter.shared.reloadAllTimelines()
        }
    }
}
