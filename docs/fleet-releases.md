# Updating every app in the fleet

How a change reaches every operator's app, from a price change to a new iOS feature, with as little per-operator work as possible.

## The model in one line

One codebase, one version number, many branded apps. Most changes never need an app update. Those that do go through one workflow that builds every operator's app and sends it to each operator's own App Store account, ring by ring.

## How Attractions.io does it, and what we copy

Attractions.io run the apps for Merlin (Alton Towers, Thorpe Park, Chessington, the Legoland parks) and other operators from one platform. What is public:

| Attractions.io | Seatfold equivalent |
|---|---|
| Each operator gets its own branded app ("a distinctly branded app for each operator", Go) | One brand file per operator in `fleet/brands/` |
| The app is listed under the operator: the Alton Towers app's seller is Merlin Entertainments, not Attractions.io | Each live app is published in the operator's own Apple Developer account |
| Content and themes change from their console ("Connect") and the app updates in the background | Config releases, films, prices, offers and food already change live from the portal |
| Maintenance and improvements are part of the subscription; features ship in quarterly platform releases | One fleet version, released to every app on a fixed calendar |
| Layrs: modules added to an operator's existing app | Not offered yet (see "Later") |

How they move binaries between accounts isn't public. What follows is our design, built around Apple's rules, which bind them too.

Sources: [Attractions.io Feature Library](https://attractions.io/feature-library), [Go launch (Blooloop)](https://blooloop.com/attractions-io-launches-go/), [Merlin rollout](https://attractions.io/learn/merlin-entertainments-rolls-out-attractions-io-mobile-app-platform), [Alton Towers on the App Store](https://apps.apple.com/app/id683491029).

## Apple's rules that shape this

- **Guideline 4.2.6:** apps made from a template "will be rejected unless they are submitted directly by the provider of the app's content". So a live operator app is published in the operator's account, not ours. Apple's alternative is one app that hosts every client (a "picker" app).
- **Guideline 2.5.2:** an app may not download code that adds or changes features. Anything new in the app needs a new build and App Review. Content, configuration and switching features on or off that are already in the reviewed build are fine.
- **Guideline 4.3(a):** don't create multiple apps of the same thing. One app per operator is fine. One app per cinema of the same operator is not.

## Four kinds of change, fastest first

| Change | Example | How it ships | Time to customers |
|---|---|---|---|
| Content | Films, times, prices, offers, menus | Portal, live | Seconds |
| Configuration | Theme, palette, logo, feature on or off | Portal config release (validated, versioned, can be rolled back) | Next app open |
| App release | New screen, new Apple feature, bug fix | Fleet release workflow, then App Review | 1 to 3 days, then up to 7 days of phased rollout |
| Required update | API change, security fix, an Apple deadline | Raise `minimumVersion` in `fleet/policy.json` | Old apps ask to update within 5 minutes |

The more we can put in the first two rows, the fewer releases the fleet needs. When a feature is built, it should ship switched off behind a config flag so operators can turn it on without a release.

## The pieces

| Piece | Where | What it does |
|---|---|---|
| Brand files | `fleet/brands/<slug>.json` | Name, bundle ID, Apple team, icon, ring, status, secret suffix. Validated by `BrandManifest` in `packages/contracts/src/fleet.ts` |
| Version policy | `fleet/policy.json` | `latestVersion` (suggest the update once) and `minimumVersion` (block until updated), with per-brand overrides |
| Fleet tool | `scripts/fleet.mjs` | `check` (CI), `generate`, `matrix`, `list` |
| Generated build settings | `ios/Config/<Slug>.xcconfig` | Written from the brand file; never edit by hand |
| Release workflow | `.github/workflows/fleet-release.yml` | Builds every app in a ring and uploads each to its own account's TestFlight |
| Update check | `GET /v1/t/{tenant}/app-status?platform=ios&version=` | Tells an app whether it is current, can update or must update |
| Update prompt | `UpdatePrompt` in CinemaCore, `UpdatePromptViews.swift` | A one-off "new version" alert, or a blocking screen below the minimum. Offline never blocks |

## Rings

| Ring | Who | When a release reaches it |
|---|---|---|
| internal | Our demo apps (Northlight, Kestrel) | Day 0 |
| pilot | Operators who opt in to early releases | About day 3, if internal is clean |
| general | Everyone | About day 7, if pilot is clean |

Apple's phased release then spreads each app's update over 7 days, and it can be paused in App Store Connect if crashes rise.

## Release routine

1. Bump `MARKETING_VERSION` in `ios/Config/Base.xcconfig` on `main`.
2. Actions › **Fleet release** › ring `internal`. Check the TestFlight builds and run through the booking flow.
3. Submit those apps for review with phased release on.
4. Run the workflow again for `pilot`, then `general`. Submit each operator's build in their App Store Connect (we hold the App Manager role there).
5. Once a brand's version is live, set `latestVersion` in `fleet/policy.json` (use `overrides` for a brand still in review). Customers on older versions are then offered the update once.
6. Only when old versions would break: raise `minimumVersion`. Keep the API working for at least the last two versions so this stays rare.

Submission for review is manual for now. Automating it through the App Store Connect API (create version, attach build, phased release, submit) is the next step once the first operator account is connected.

## Adding an operator

1. The operator enrols in the Apple Developer Program (£79 a year, in their name) and adds us as **App Manager**.
2. In their App Store Connect: create the app record and a Team API key (App Manager role). They add the three key values as GitHub secrets `ASC_KEY_ID_<SUFFIX>`, `ASC_ISSUER_ID_<SUFFIX>` and `ASC_PRIVATE_KEY_<SUFFIX>`. A key is never pasted into chat or email.
3. Add `fleet/brands/<slug>.json` (start in ring `pilot` or `general`) and their icon to `ios/Resources/Assets.xcassets`.
4. `pnpm build:contracts && node scripts/fleet.mjs generate && node scripts/fleet.mjs check`, then open a PR.
5. Run **Fleet release** with `brands` set to the new slug.

An operator that leaves: set `status` to `paused`. Their app stops receiving releases and keeps working while the API supports its version.

## New Apple technology and yearly deadlines

Apple's year has a fixed shape, so the fleet plans for it:

| When | What happens | Our routine |
|---|---|---|
| June (WWDC) | New iOS beta, new features and design | Spike the new features in the demo apps; decide what goes in the autumn release |
| September | New iOS ships | Fleet release built with the new Xcode, ring by ring, in the first two weeks |
| Spring (usually April) | App Store requires builds made with the latest Xcode and SDK | Every app must have had at least one release built with it; `fleet.mjs list` shows who is behind |
| Any time | New privacy or policy rules (privacy manifests, account deletion, age ratings) | Fixed once in the codebase, shipped as a fleet release; `minimumVersion` raised only if Apple requires it |

Because every operator runs the same code, a new Apple feature is built once and reaches everyone through the same workflow. Per-operator work is limited to App Review for each app.

## Small independents: one shared app

An operator with one or two screens may not want an Apple Developer account. Guideline 4.2.6 allows one app that hosts many clients, so a single **Seatfold Cinemas** app (cinema picker first, then each cinema's own theme) would cover them with no account, review or fee on their side. It is not built yet; it needs a cinema picker before the tenant is chosen.

## Later

- Automate App Store submission and phased release through the App Store Connect API.
- A fleet page in the portal for Seatfold staff: each app's live version, review status and how many customers are on each version (app version sent with analytics events).
- Screenshots per brand from the UI tests, uploaded with the metadata.
- A Layrs-style SDK for operators who already have an app.
