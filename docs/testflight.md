# Getting the demo app on TestFlight

The **Northlight Demo** scheme archives a release build that always runs on the bundled demo data: fictional films, seat maps, food, offers, 640 demo points and memberships, all offline. No backend is needed, payments are simulated and the app says so. Internal TestFlight testing needs no App Review and costs nothing beyond the Apple Developer membership.

## One-off setup (about 15 minutes)

1. **Mac and Xcode.** Install a version of Xcode that includes the iOS 27 SDK, plus XcodeGen: `brew install xcodegen`.
2. **Project.** In the repo: `cd ios && xcodegen generate && open Cinema.xcodeproj`.
3. **Signing.** Xcode › Settings › Accounts: sign in with the Apple ID on the Gitwork team (B27Y4M6S3Y, already set in `ios/Config/Base.xcconfig`). Signing is automatic.
4. **Register the app ID.** Run the **Northlight Demo** scheme once on your iPhone with a cable. Xcode creates `uk.co.gitwork.northlight.cinema`, the widget ID and the App Group for you.
5. **App Store Connect record.** [appstoreconnect.apple.com](https://appstoreconnect.apple.com) › Apps › **+** › New App:
   - Platform: iOS
   - Name: must be unique across the App Store, e.g. "Northlight Cinema Demo (Gitwork)". Only testers see it.
   - Primary language: English (UK)
   - Bundle ID: `uk.co.gitwork.northlight.cinema`
   - SKU: anything, e.g. `northlight-demo`
   - User access: Full access

## Each upload (about 5 minutes, plus Apple processing)

1. In `ios/Config/Base.xcconfig`, increase `CURRENT_PROJECT_VERSION` by one (every upload needs a new build number).
2. In Xcode choose the **Northlight Demo** scheme and **Any iOS Device (arm64)** as the destination.
3. **Product › Archive.** When the Organizer opens: **Distribute App › TestFlight Internal Only › Distribute**.
4. Apple processes the build (usually 10 to 30 minutes) and emails you.
5. App Store Connect › your app › **TestFlight** › Internal Testing: create a group, add yourself and teammates (they must be users on the Gitwork App Store Connect team).
6. Install the **TestFlight** app on your iPhone and accept the invite.

## Notes

- Demo data lives in memory, so bookings made in the demo reset when the app is closed fully. That keeps every demo starting clean.
- The app declares exempt encryption only (`ITSAppUsesNonExemptEncryption`), so you won't be asked about export compliance on each upload.
- Privacy manifests are included for the app and the widget (preferences, App Group, anonymous analytics).
- External testers (people outside your team) need a short Beta App Review the first time. Internal testers do not.
- Later, CI can upload builds automatically with an App Store Connect API key stored as a GitHub secret. That is free; it just needs the key.
