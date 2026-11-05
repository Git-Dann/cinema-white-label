import XCTest

/// Walks the main booking journey against the offline mock service and
/// attaches a screenshot at each stage. CI publishes them for design review.
final class ScreenshotTests: XCTestCase {
    private var app: XCUIApplication!
    private var step = 0

    override func setUp() {
        continueAfterFailure = false
        app = XCUIApplication()
        app.launchArguments = ["-mock-data", "-ui-testing"]
        app.launch()
    }

    private func shot(_ name: String) {
        step += 1
        let a = XCTAttachment(screenshot: app.screenshot())
        a.name = String(format: "%02d-%@", step, name)
        a.lifetime = .keepAlways
        add(a)
    }

    private func element(_ query: XCUIElementQuery, _ format: String, timeout: TimeInterval = 15) -> XCUIElement {
        let e = query.matching(NSPredicate(format: format)).firstMatch
        XCTAssertTrue(e.waitForExistence(timeout: timeout), "Missing element: \(format)")
        return e
    }

    func testBookingJourneyScreenshots() {
        // Home
        _ = element(app.descendants(matching: .any), "label BEGINSWITH 'Featured'", timeout: 25)
        sleep(2) // let artwork decode
        shot("home")

        // Film detail
        element(app.buttons, "label BEGINSWITH 'Ember Protocol'").tap()
        _ = element(app.descendants(matching: .any), "label BEGINSWITH 'Showtimes'")
        sleep(1)
        shot("film-detail")

        // Showtimes
        app.buttons["Book Tickets"].tap()
        sleep(1)
        shot("showtimes")

        // Seat map: premiere auditorium (pods and VIP beds)
        element(app.buttons, "label CONTAINS 'Premiere'").tap()
        XCTAssertTrue(app.navigationBars["Choose Seats"].waitForExistence(timeout: 15))
        sleep(1)
        shot("seat-map-premiere")

        element(app.buttons, "label CONTAINS 'VIP bed, sold in pairs, available'").tap()
        sleep(1)
        shot("seat-selected")

        // Tickets
        app.buttons["Continue"].tap()
        XCTAssertTrue(app.buttons["Review booking"].waitForExistence(timeout: 10))
        shot("tickets")

        // Food and drink
        app.buttons["Review booking"].tap()
        let popcorn = element(app.buttons, "label BEGINSWITH 'Sweet popcorn'")
        shot("food")
        popcorn.tap()
        let add = element(app.buttons, "label BEGINSWITH 'Add'")
        shot("food-options")
        add.tap()
        sleep(1)
        element(app.buttons, "label BEGINSWITH 'Continue'").tap()

        // Review and pay
        let pay = element(app.buttons, "label BEGINSWITH 'Pay'")
        shot("review")
        pay.tap()
        XCTAssertTrue(app.staticTexts["You're booked"].waitForExistence(timeout: 15))
        sleep(1)
        shot("confirmed")

        // Tickets tab and ticket detail
        app.buttons["View ticket"].tap()
        sleep(2)
        shot("tickets-tab")
        element(app.cells, "label CONTAINS 'Ember Protocol'").tap()
        sleep(1)
        shot("ticket-detail")
    }
}
