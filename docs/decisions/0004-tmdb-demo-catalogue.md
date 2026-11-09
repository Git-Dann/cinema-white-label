# 0004: TMDB as a demo-only film catalogue

**Status:** accepted, 6 Nov 2026 (demo use only)

## Context
The fictional films and drawn posters made the demo feel unfinished. Real
films need a data source. Licensed providers (e.g. MovieGlu) cost money and
are only worth it once an operator signs up. TMDB's API is free but licensed
for non-commercial use; its artwork belongs to the studios.

## Decision
Add a demo catalogue importer for TMDB, separate from the production
provider path (`TmdbEnrichmentProvider` stays gated on a commercial licence).

- Off unless the API has `DEMO_CATALOGUE=tmdb` and `TMDB_API_KEY`.
- Imports UK now-showing and upcoming films (GB certificates and release
  dates), with one poster and one backdrop each. Images are fetched from TMDB
  through our media endpoint, recorded with provider `tmdb`, attribution
  "Image: TMDB" and a "demo only" usage restriction.
- Fictional films are hidden from listings, not deleted, so existing bookings
  keep working. Turning the demo off: unset the variables and unhide films.
- The portal Films page and the app's Account › About show TMDB's notice:
  "This product uses the TMDB API but is not endorsed or certified by TMDB."
- No new dependencies (plain `fetch`).

## Consequences
- Fine for private demos (TestFlight, prospective partners). **Not** for a
  paying operator: their catalogue must come from their own feed or a licensed
  provider, or TMDB's commercial terms must be agreed first.
- Screenings are now kept seven days ahead automatically
  (`ensureScreeningHorizon`): on every deploy, daily via Vercel Cron
  (`/v1/cron/daily`, needs `CRON_SECRET`), and after each import.
