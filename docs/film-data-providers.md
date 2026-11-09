# Film data and artwork providers

## Interface
`FilmCatalogueProvider` (`backend/src/catalogue/providers/provider.ts`) returns provider records with external ids, cross-references (e.g. IMDb) and asset references including licence, attribution, territory and expiry. Providers never supply booking inventory.

## Adapters
| Adapter | Status | Notes |
|---|---|---|
| Fixture | Active in dev | Original fictional films, locally generated artwork (`backend/scripts/generate-artwork.ts`). |
| Operator / distributor feed | Implemented (JSON) | Preferred production source for metadata and licensed artwork. |
| Licensed commercial provider (e.g. MovieGlu) | Not built | Evaluate licence terms, UK coverage, showtime data quality and artwork rights before integrating. |
| TMDB enrichment | Mapping only, disabled | Enabled only with `TMDB_API_KEY` **and** `TMDB_COMMERCIAL_LICENCE=confirmed`. The free API is not a commercial licence; artwork is never imported through this adapter. |
| TMDB demo catalogue | Implemented, off by default | Demo only (decision 0004). `DEMO_CATALOGUE=tmdb` + `TMDB_API_KEY` on the API, then **Films › Load real films** in the portal (refreshes daily). Imports UK films with attributed artwork and hides the fictional ones. |

## Resolution
`resolveFilms` merges records by precedence (operator → licensed → enrichment → fixture) with field-level provenance. Matching: linked external id → shared cross-reference → unique normalised title + year (±1). Ambiguous matches go to a review queue and never create a film. Manual admin edits set provenance to `operator` so syncs do not overwrite them.

## Artwork
Assets record provider, source, licence, attribution, restrictions, territory, language, size and expiry. Expired assets are never served. Delivery: `/v1/media/{id}?w=` serves cached renditions (160–1600 px) without upscaling; clients crop with the operator-set focal point. Detail heroes use landscape backdrops; lists use portrait posters. No scraping of cinema or distributor websites.
