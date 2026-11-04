# Auditorium layout specification

Schema: `packages/contracts/src/layout.ts` (Swift mirror: `CinemaCore/Models/Layout.swift`). Fixtures: `shared/fixtures/layouts/*.json` with SVG previews.

## Coordinates
Layout units: canvas width = 1.0, height = 1 / `aspectRatio`. Every x, y, width and height is normalised to the canvas width, origin top-left. Renderers scale uniformly, so geometry never distorts across devices.

## Elements
- **screen**: centre, width, curvature (sagitta / width, 0–0.3), edge (`top|bottom|left|right`), label. It is a mapped element, not decoration; validation keeps the curve on the canvas.
- **sections** and **rows**: explicit `order` for accessible navigation. Row labels are data (`I` and `O` are skipped in fixtures, as many UK cinemas do).
- **seats**: stable `id` (never derived from array position), `label`, `order` within row, centre `x,y`, `rotation` (degrees), footprint `width,height`, `type` (`standard|premium|recliner|sofa|wheelchair|companion`), `priceCategory`, `accessibility[]`, `companionFor[]`, `groupId` (sold together), `restrictedView` (customer-facing text).
- **features**: entrances, exits, walkways, stairs, labels.

## Validation (before publish)
Unique seat ids; labels unique per row; rows/sections exist; seats and screen inside the canvas; no overlapping footprints; companion references exist; groups have at least two seats.

## Versioning
`AuditoriumLayoutVersion` rows are immutable once `PUBLISHED`. Screenings reference a specific version, so editing a layout creates a new version and never changes seats on existing bookings. Live availability is stored separately (`ScreeningSeat`).

## Renderer (iOS)
- One SwiftUI `Canvas` draws screen + projection glow, features, row labels (both sides) and seats; SF Symbols mark state so colour is never the only signal (✓ selected, ✕ taken, – blocked, wheelchair, companion, restricted view). Premium seats get a band, wheelchair spaces a pill shape.
- `SeatMapGeometry` (pure Swift, tested) handles fit, zoom limits (seats reach ≥ 1.6 × 44 pt), anchored pinch zoom, pan clamping, spatial-grid hit-testing with a near-miss tolerance that never jumps an aisle, and a device-independent camera that survives iPhone Duo fold/unfold.
- At overview scale, the first tap zooms into the area; the next tap selects. A mini-map with the screen marker appears whenever zoomed in; "show whole auditorium" resets.
- Accessibility: `accessibilityChildren` exposes every seat ("Row F, Seat 8, standard, available, £12.50."), plus a structured section → row → seat list view that VoiceOver users get by default.

## Seat categories and rules (operator-configurable)
Each screening response includes `seatCategories` (only those in the layout) and `seatRules`:
- **Category:** `id` (= `Seat.priceCategory`), `label`, `description`, `shape` (`seat|recliner|pod|bed|sofa|space`), `icon` (from an SF Symbol allow-list; anything else is ignored by the app), optional light/dark `fill` and `accent` colours. Accents must reach 3:1 against the theme background (`validateSeatCategories`).
- **Rules:** `maxTickets`, `orphanSeatPolicy` (`allow|warn|block`), `companionPolicy` (`none|warn|requireWheelchair`). Wheelchair spaces always warn and never block.
- Structural `Seat.type` (`standard, premium, recliner, sofa, luxePod, vipBed, wheelchair, companion`) drives accessibility semantics. The category drives the commercial presentation, so a new seat product needs only backend data.

## Interaction model
Taps go through `SeatTapInterpreter`: a seat toggles instantly; at overview scale a tap zooms into that area first; a double tap on empty space zooms in (or resets at max zoom). Pinch and drag move a device-independent camera. `SeatRulesEngine` mirrors the server rules for instant feedback, and Continue explains why it is disabled.
