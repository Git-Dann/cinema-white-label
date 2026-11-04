# Theme system and white-label identity

## Build-time vs runtime
| Build-time (per app build) | Runtime (tenant config, no app update) |
|---|---|
| Bundle ID, signing, entitlements, app icon, `TENANT_SLUG`, API base URL (`ios/Config/*.xcconfig`) | Logos, wordmark, palette, theme, available themes, feature flags, home sections, support/legal, booking limits |

## Themes and palettes
Themes (`classic`, `midnight`, `premium`, `light`, `highContrast`) define surfaces, text and appearance policy. Brand palettes supply `accent` and `secondary`, each with a light and dark variant (one hex rarely passes contrast on both). `resolveTheme(theme, palette)` produces 35 semantic tokens per appearance; only High Contrast is allowed to adjust brand colours automatically.

## Validation
`CONTRAST_REQUIREMENTS` (contracts) checks WCAG 2.2 AA: 4.5:1 for text pairs, 3:1 for meaningful non-text UI (seat states, focus, screen). Checked when approving a palette, before publishing, and again on device before adopting a config.

## Publishing
Draft (`TenantSettings.draft`) → preview (`POST /preview`, no save) → publish (immutable `ConfigRelease`, optional schedule) → rollback (republishes an old snapshot as a new version). An immediate publish cancels older scheduled releases. All actions are audited.

## App behaviour
Bundled known-good config → cached config → remote (ETag). Invalid remote configs are rejected and logged (`theme_load_failed`). Customers may choose any offered theme; Increase Contrast switches to High Contrast when offered.
