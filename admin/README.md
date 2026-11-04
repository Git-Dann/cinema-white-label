# Operator admin portal

Next.js 15 (App Router, React 19) admin for cinema operators: branding and theme with a live,
contrast-validated app preview, config releases and rollback, cinemas, and films/artwork focal points.

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
