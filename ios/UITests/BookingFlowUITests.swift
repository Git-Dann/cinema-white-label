import XCTest

/// End-to-end UI tests. Require the local backend (see README: pnpm dev:backend)
/// and the Northlight scheme. Not executed in CI yet (no macOS runner).
final class BookingFlowUITests: XCTestCase {
    override func setUp() { continueAfterFailure = false }

    func testTabsAreReachable() {
        let app = XCUIApplication()
        app.launch()
        for tab in ["Films", "Cinemas", "Tickets", "Account", "Home"] {
            app.tabBars.buttons[tab].tap()
            XCTAssertTrue(app.navigationBars.firstMatch.waitForExistence(timeout: 5), "\(tab) did not load")
        }
    }

    func testBookTwoSeatsUsingAccessibleList() {
        let app = XCUIApplication()
        app.launch()
        app.tabBars.buttons["Cinemas"].tap()
        app.cells.containing(.staticText, identifier: "Northlight Leeds Riverside").firstMatch.tap()
        // First on-sale showing at this cinema.
        let showing = app.cells.buttons.element(boundBy: 0)
        XCTAssertTrue(showing.waitForExistence(timeout: 10))
        showing.tap()

        let viewMenu = app.buttons["Seat view: map"]
        XCTAssertTrue(viewMenu.waitForExistence(timeout: 10))
        viewMenu.tap()
        app.buttons["List"].tap()

        // Expand the first row with free seats and choose two seats.
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Row D'")).firstMatch.tap()
        let available = app.buttons.matching(NSPredicate(format: "label CONTAINS 'standard, available'"))
        available.element(boundBy: 0).tap()
        available.element(boundBy: 0).tap()

        app.buttons["Continue"].tap()
        XCTAssertTrue(app.buttons["Review booking"].waitForExistence(timeout: 10))
        app.buttons["Review booking"].tap()
        app.buttons.matching(NSPredicate(format: "label BEGINSWITH 'Pay'")).firstMatch.tap()
        XCTAssertTrue(app.staticTexts["You're booked"].waitForExistence(timeout: 15))
    }
}
