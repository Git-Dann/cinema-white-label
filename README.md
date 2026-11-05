# Cinema Platform

A white-label cinema booking platform: an Apple-native iOS app, a NestJS/PostgreSQL backend and a Next.js operator portal. Development uses two fictional operators (Northlight Cinemas and Kestrel Picturehouse), original fictional films and generated artwork, so nothing depends on commercial credentials.

## What works today (Phase 1 slice)
- Tenant configuration: versioned, validated releases with WCAG AA contrast checks, scheduling and rollback; the app keeps a known-good cached config.
- Five themes (Classic, Midnight Cinema, Premium, Light, High Contrast) independent of brand palettes.
- Films, cinemas (nearby, search, favourites), screenings by date and format.
- Vector seat map: screen position, curved/staggered rows, aisles, wheelchair and companion spaces, premium, recliners and sofas; pinch, pan, tap-to-zoom, mini-map, accessible list alternative.
- Transactional seat holds with server expiry, conflict handling and live updates (SSE + polling fallback).
- Server-side pricing (format supplements, fees, certificate rules), idempotent simulated checkout, stored booking, QR admission ticket, offline ticket cache.
- Apple Wallet boundary that returns an explicit demo state until pass-signing certificates exist.
- Operator portal: branding, palettes, live theme preview, publishing, rollback, venues, films, focal points.

See `TASKS.md` for what is next and `docs/` for specifications.

## Prerequisites
- Node 22 + pnpm 10, PostgreSQL 16
- iOS: Xcode with the iOS 27 SDK, [XcodeGen](https://github.com/yonaskolb/XcodeGen)

## Run it
```bash
pnpm install
pnpm build:contracts

# Database (adjust backend/.env if needed)
createuser -s cinema; createdb -O cinema cinema   # or use your own Postgres
cp backend/.env.example backend/.env
cd backend && pnpm db:migrate && pnpm db:seed && pnpm dev   # http://localhost:3000, docs at /docs

# Admin portal (new terminal)
cd admin && pnpm dev                                         # http://localhost:3001
```
Dev logins: `admin@northlight.example` / `operator-dev-password`, `platform@cinema.example` / `platform-dev-password`.

iOS:
```bash
cd ios && xcodegen generate && open Cinema.xcodeproj
```
Pick the **Northlight** or **Kestrel** scheme and run on a simulator. The app talks to `http://localhost:3000` (set `API_BASE_URL` in `ios/Config/Base.xcconfig` for a device).

## Tests
```bash
cd packages/contracts && pnpm test     # theme + layout contracts
cd backend && pnpm test                # unit + integration (creates/uses DB cinema_test)
cd ios/Packages/CinemaKit && swift test
```
The backend integration tests need a `cinema_test` database owned by the `cinema` user (`createdb -O cinema cinema_test`).
