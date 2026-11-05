# Operator admin portal

Next.js 15 (App Router, React 19) admin for cinema operators: branding and theme with a live,
contrast-validated app preview, config releases and rollback, cinemas, and films/artwork focal points.

## Commerce and seating pages

- **Auditorium layouts** (`/layouts`): venues, screens and layout versions. Opening a version shows the
  layout editor: an SVG seat map drawn with the same maths as `shared/fixtures/layouts/*.preview.svg`,
  a row generator (rows, blocks and aisles, curvature, stagger, built with `buildRow` from
  `@cinema/contracts`), screen and canvas controls, a seat inspector (type, price category, restricted
  view, accessibility, companions, groups, quick "wheelchair + companion" and "sofa pair" actions) and
  live server validation (`POST layouts/validate`, debounced) with problem seats outlined in red.
  Keyboard: Delete removes selected seats, arrow keys nudge them (Shift for bigger steps), Escape clears.
  Drafts can be saved, published (operator admins only, blocked while issues remain) or deleted;
  published and retired versions are read-only and can seed a new draft. "New screen" creates an
  auditorium with a starter draft.
- **Seat categories & pricing** (`/seating`): categories with shape, icon and optional custom
  light/dark colours (the API rejects colours that fail 3:1 contrast and the reasons are listed), plus
  the ticket type × category price grid (empty = not sold). Prices are read-only for non-operator-admins.
- **Food & drink** (`/food`): products by category with stock, availability toggle, venue scope and a
  modifier group editor.
- **Vouchers** (`/vouchers`): codes with value, scope, redemptions and validity; create, edit terms,
  activate or deactivate (operator admins only).

Role rules mirror the API (`permissions()` in `lib/format.ts`): content editors can view these pages
but cannot change prices, vouchers, seat categories, food and drink or layouts.

## Run

```sh
pnpm install                       # from the repo root
pnpm --filter @cinema/contracts build   # if packages/contracts/dist is missing
cd admin
pnpm dev                           # http://localhost:3001
# or
pnpm build && pnpm start           # production build on port 3001
```

The NestJS API must be running (default http://localhost:3000) and must allow the admin origin
(`ADMIN_ORIGINS`, default `http://localhost:3001`). The admin must run on port 3001 for CORS.

## Environment

| Variable               | Default                 | Purpose                                      |
| ---------------------- | ----------------------- | -------------------------------------------- |
| `NEXT_PUBLIC_API_BASE` | `http://localhost:3000` | API origin the browser calls (build-time).   |

## Dev logins

| Email                        | Password                | Role                          |
| ---------------------------- | ----------------------- | ----------------------------- |
| platform@cinema.example      | platform-dev-password   | Platform admin (all tenants)  |
| admin@northlight.example     | operator-dev-password   | Operator admin (northlight)   |
| admin@kestrel.example        | operator-dev-password   | Operator admin (kestrel)      |
| editor@northlight.example    | editor-dev-password     | Content editor (no publish)   |

## Known gaps

- The bearer token is stored in `localStorage` (see `lib/api.ts`); production should use an
  httpOnly cookie or a backend-for-frontend.
- All pages are client-rendered and call the API directly from the browser.
- Screens (auditoriums) cannot be renamed or deleted: the API has no endpoint for it.
- The layout editor has no undo history, drag-to-move or feature (aisle/entrance) editing; the
  screen is always on the top edge. Money is shown as GBP on the food and voucher pages.
