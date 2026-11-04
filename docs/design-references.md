# Design reference analysis

The supplied screenshots (a third-party film-tracking app) set the visual direction. They are treated as direction, not a template; patterns were adapted to a booking product and to native iOS controls.

| Reference pattern | Adopted as |
|---|---|
| Large bold titles ("Discover", "Shows"), dark backgrounds | Large inline titles on every tab, theme-driven backgrounds (Midnight Cinema by default for Northlight). |
| Section header "Title ›" with muted subtitle | `SectionHeader` component, linking to a full grid. |
| Tall featured poster cards with title + 2-line synopsis below | `FeaturedFilmCard` in a paging carousel on Home. |
| Smaller poster rows with captions | `PosterCard` rows for Now Showing / Coming Soon (caption = release date or format). |
| Fanned poster stacks (awards, years) | `FannedPosterStack`, reserved for collections/promotions. |
| Detail: blurred backdrop hero tinted by artwork, centred poster with shadow, title, date line | `FilmDetailView` hero uses the landscape backdrop tinted by its dominant colour (portrait posters are never stretched into heroes). |
| Two pill buttons (+ Watchlist / Watch) | "Book Tickets" (accent, primary) + "Trailer" (glass). |
| Facts row (IMDb, Runtime, Genre, Certificate) | Runtime, Certificate, Genre, Formats; spoken values for VoiceOver. |
| Trailers carousel, About list with accent bars | Same structure; trailers disabled until a licensed source exists. |
| Floating glass tab bar, glass context menus | Native `TabView` with Liquid Glass, `tabBarMinimizeBehavior`, glass controls on the seat map. |
| 3-column poster grids | Adaptive `LazyVGrid` (more columns on wide displays). |

Not adopted: third-party rating badges ("PRO", IMDb scores) and watch-tracking actions, which don't fit a cinema operator's app. Missing states (loading, empty, offline, errors, hold expiry) were added using the same components.
