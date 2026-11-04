# Feature parity review (Vista-based operator apps)

Source: an internal technical analysis of a UK operator's Android app (Vista platform). It is used **only as evidence of functional requirements**. No proprietary code, assets, endpoints, credentials or operator-specific business logic are used, and nothing depends on that operator's CDN or APIs.

## Status by area

| Area | Requirement | Status |
|---|---|---|
| **Seat selection** | Native (not WebView) zoomable/pannable map, screen position and geometry | Done: SwiftUI `Canvas` renderer + tested `SeatMapGeometry` |
| | Pinch, drag, double-tap | Done. Double-tap on empty space zooms in, or resets at max zoom (`SeatTapInterpreter`). Seat taps act instantly with no double-tap delay |
| | Available, selected, unavailable, reserved, accessible states | Done. Symbols as well as colour; hatching with Differentiate Without Colour |
| | Standard, premium, recliner, Luxe pod, sofa, VIP bed, wheelchair | Done: `Seat.Kind` + `premiere` fixture layout |
| | Configurable categories, pricing, icons, colours, labels | Done: `SeatCategory` per operator (backend table, contrast-validated, SF Symbol allow-list), delivered with each screening |
| | Connected groups (sofas, beds), wheelchair/companion dependency | Done: `groupId` selection and `companionPolicy` (`none`, `warn`, `requireWheelchair`) |
| | Stranded single-seat rule, max seats | Done: `orphanSeatPolicy` and `maxTickets`, evaluated on device (`SeatRulesEngine`) and server, with parity tests |
| | Real-time availability, reservation expiry | Done: SSE + polling fallback, server-derived countdown |
| | Summaries, pricing, haptics, animation, VoiceOver | Done. Category legend with prices, a selection "pop" animation respecting Reduce Motion, list alternative |
| | Large auditorium performance | Single Canvas plus spatial grid hit-testing. **Not yet profiled on device** |
| **Data model** | Operators, brands, locations | Tenants + venues (`features` per venue). A separate "brand" layer under one operator is planned |
| | Films, formats, certificates, trailers, artwork | Done |
| | Ticket types, pricing tiers, discounts | Done: ticket types × categories, format supplements, vouchers |
| | Food and drink, modifiers, bundles, ordering | Done: venue menus, modifier min/max validation, bundles, stock, priced on the server and stored on the booking |
| | Seat delivery / collection | Done: per-venue `seatDelivery` flag and `fulfilment` on the booking |
| | Cancellations and refunds | Done: operator cutoff, refund via the payment provider, seats released, ticket voided |
| | Promotions, vouchers | Vouchers done (percent or amount, scope, minimum spend, atomic single-use). Promotions content: planned |
| | Loyalty, memberships, gift cards | Modelled (`LoyaltyAccount`, `MembershipPlan`, `GiftCard`), not exposed. Gift cards need operator legal/finance sign-off |
| | Transaction history, digital tickets | Done: bookings list, offline QR tickets |
| **Branding** | Logos, palettes, themes, contrast checks | Done |
| | Typography | Done within system fonts (design + heading weight). Custom font files need an App Store build |
| | Splash artwork, home sections, feature flags per operator and location | Done (`splashUrl`, home sections, venue features) |
| | Seat colours and icons per operator | Done (seat categories) |
| | App icons | Build-time (xcconfig per operator); cannot change remotely |
| **Media** | Provider-independent layer, renditions, caching, placeholders, fallback, rights | Done: `MediaStorage` interface, optional `MEDIA_CDN_BASE`, focal points, expiry, URL+memory cache, prefetch, local typographic fallback |
| | Vista / distributor adapters | Interface ready. Adapters are written only once licensed access exists |
| **Apple** | Wallet (signed by the backend only), Apple Pay | Boundaries ready; needs certificates and a PSP |
| | App Intents, Spotlight | Done (navigation only; no purchases through Siri) |
| | Live Activities, widgets, BackgroundTasks | Planned (needs widget extension target) |
| | Persistence | JSON cache with file protection for tickets and config. SwiftData can replace it when local data grows (decision 0002) |
| **Analytics** | Typed schema, privacy-aware, replaceable providers | Done: per-event property schemas on the server, `AnalyticsProvider` on iOS, customer opt-out |
| **Admin** | Manage operators, locations, films, layouts, pricing, food, memberships, themes, promotions | Themes, venues and films done. Seat categories, food, vouchers and the layout editor: API/schema first, admin UI next |

## Remote vs build-time
- **Remote (no release):** theme, palette, typography design/weight, logos, splash artwork, home sections, operator and venue feature flags, seat categories (labels, icons, shapes, colours), seat rules, prices, menus, vouchers, layouts.
- **Build-time (App Store build):** app icon, bundle ID and entitlements (Wallet pass types, Apple Pay merchant IDs, App Groups), custom font files, new SF Symbol usage beyond the allow-list, new native capabilities.
