# Getting the app on TestFlight

This covers the single demo app. To build and upload every operator's app at once, see [fleet-releases.md](fleet-releases.md).

Automatic TestFlight uploads use the **Northlight** release build, which talks to the hosted API (`https://cinema-api-flame.vercel.app`). Payments are simulated and labelled.

The **Northlight Demo** scheme is still there for showing the app offline: it archives a release build that always runs on the bundled demo data: fictional films, seat maps, food, offers, 640 demo points and memberships, all offline. No backend is needed, payments are simulated and the app says so. Internal TestFlight testing needs no App Review and costs nothing beyond the Apple Developer membership.

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

## Automatic uploads from GitHub (recommended)

`.github/workflows/testflight.yml` archives the **Northlight** release build, which uses the hosted API at `https://cinema-api-flame.vercel.app` (payments are still simulated), and uploads it to TestFlight whenever app code is pushed (and on demand from the Actions tab). Build numbers come from the workflow run number, so you never bump them by hand. It is free on a public repository.

One-off setup:

1. Create the app record in App Store Connect (step 5 above).
2. App Store Connect › **Users and Access** › **Integrations** › **App Store Connect API** › **Team Keys** › **+**. Name it "GitHub TestFlight", access **Admin** (needed so it can create the distribution certificate and profiles). Download the `.p8` file: Apple only lets you download it once.
3. Note the **Key ID** (in the list) and the **Issuer ID** (above the list).
4. GitHub › the repository › **Settings** › **Secrets and variables** › **Actions** › **New repository secret**, three times:
   - `ASC_KEY_ID`: the Key ID
   - `ASC_ISSUER_ID`: the Issuer ID
   - `ASC_PRIVATE_KEY`: open the `.p8` in TextEdit and paste the whole contents, including the BEGIN and END lines
5. Actions › **TestFlight** › **Run workflow** to send the first build.

Never paste the key into chat, email or the repository. If it leaks, revoke it in App Store Connect and create a new one.
