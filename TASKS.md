# Task list

Prioritised. Phase numbers follow the master specification.

## Verify first (blocked in the build environment)
1. **Build the iOS app in Xcode and fix compile errors.** SwiftUI targets (`CinemaDesign`, `CinemaSeatMap`, `CinemaFeatures`, app target) were written without a compiler; only `CinemaCore` is compiled and tested. Expect small API fixes (Liquid Glass modifiers, `Tab`, `MagnifyGesture`, `MKMapItem(location:address:)`).
2. Run on iPhone 18 Pro Max, a compact iPhone and iPhone Duo (folded, unfolded, resizing). Capture screenshots and compare with the design references in `docs/design-references.md`.
3. VoiceOver, Dynamic Type (AX5), Switch Control and Increase Contrast pass over the seat map and list alternative.
4. Run `CinemaAppUITests` against the local backend.
5. Profile the seat map with the 226-seat curved layout; target 120 fps pan/zoom on ProMotion.

## Parity extension (see docs/feature-parity.md)
- [x] Configurable seat categories (labels, icons, shapes, colours) and seat rules from the backend.
- [x] Luxe pods, VIP beds, companion policy, client-side rules engine with server parity tests.
- [x] Double-tap zoom, category legend with prices, SwiftUI previews, mock auditoriums, sold-out/conflict/loading states.
- [x] Food and drink (modifiers, bundles, stock, seat delivery), vouchers, cancellation and refunds.
- [x] Typed analytics schema, replaceable providers, opt-out. Media storage abstraction, prefetch, fallback artwork.
- [x] App Intents and Spotlight.
- [x] Admin UI for seat categories + pricing grid, food and drink, vouchers, and a visual auditorium layout editor (draft, validate, publish).
- [ ] Admin: promotions content, booking fee and format supplement editing, layout editor undo/drag/features.
- [ ] Loyalty earn/burn and memberships (models exist); gift cards pending operator sign-off.
- [ ] Brand layer between operator and venues (multi-brand operators).
- [ ] Live Activities + widget extension target; BackgroundTasks refresh of tickets.

## Phase 1 gaps
- [ ] Seat map: keyboard focus navigation between seats, Dynamic Type for row labels, on-device profiling with 400+ seats.
- [ ] Availability stream through Redis pub/sub when running more than one API instance.
- [ ] Customer-facing copy review and localisation catalogue (en-GB first).
- [x] CI pipeline: contracts, backend with Postgres, `swift test` on Linux, admin build, OpenAPI and fixture drift checks.
- [ ] CI: xcodebuild on a macOS runner once the app compiles.

## Phase 2 – content and administration
- [ ] Film provider ingestion job (operator feed + licensed provider adapters, review queue UI).
- [ ] Media library with rights metadata editing and expiry enforcement in admin.
- [x] Auditorium layout editor (row generator, seat inspector, live validation, versioned publish).
- [ ] Screening and price management in admin.
- [ ] Home section editor, support/legal editor.
- [ ] Admin: httpOnly cookie sessions instead of localStorage tokens; palette delete/reject; actor names in audit.

## Phase 3 – Apple and commercial services
- [ ] Apple Pay via a PSP sandbox (merchant ID, payment processing certificate).
- [ ] Signed Wallet passes + PassKit web service (needs Pass Type ID certificate).
- [ ] Live Activities and Dynamic Island for upcoming screenings and food collection.
- [ ] Widgets, App Intents/App Shortcuts, Spotlight indexing.
- [ ] Sign in with Apple and passkeys; account registration.
- [ ] Memberships and concessions (models exist, not exposed).
- [ ] Real booking inventory adapters per operator.

## Phase 4 – platform operations
- [ ] Multi-tenant release configurations, monitoring, analytics dashboards, promotions, production deployment.

## Done
- [x] Contracts: themes, contrast validation, tenant config, layout geometry, seat categories (24 tests).
- [x] Backend: config releases, films/providers, media, venues, screenings, holds, pricing, food, vouchers, cancellation, Wallet boundary, analytics, admin API (46 tests).
- [x] CinemaCore: models, API client, config store, seat geometry/hit-testing, rules engine, selection, booking flow, mock service (64 tests).
- [x] Admin portal: branding, live preview, publish/rollback, venues, films (Playwright-verified).
