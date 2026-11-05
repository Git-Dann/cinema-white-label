# Hosting the demo (free tiers)

Three Vercel projects from this one repository, plus a Supabase database:

| Vercel project | Root Directory | What it serves |
|---|---|---|
| `cinema-white-label` (existing) | `site` | Seatfold marketing site |
| `cinema-api` | `backend` | NestJS API as a serverless function, OpenAPI at `/docs` |
| `cinema-admin` | `admin` | Operator portal (Next.js) |

Production deployments come from `main`, so the platform code must be merged to `main` first.

## 1. Database (Supabase)

1. supabase.com › New project › name `cinema-platform`, region **London (eu-west-2)**, free plan. Click **Generate a password** and save it in your password manager.
2. When it is ready, open **Connect** and copy two URIs, replacing `[YOUR-PASSWORD]` with the password in each:
   - **Transaction pooler** (port 6543): add `?pgbouncer=true&connection_limit=1` to the end. This is `DATABASE_URL`, used by the API's serverless functions. Each function holds one connection only while a query runs, so traffic never fills the pool.
   - **Session pooler** (port 5432): this is `DIRECT_URL`, used only by migrations at build time (Prisma's migrations need a session connection).

   With only the session pooler as `DATABASE_URL` everything still works, but the session pool has 15 slots: concurrent builds and busy functions can fill it (`EMAXCONNSESSION ... max clients reached`).

## 2. API project

Vercel › Add New › Project › import `Git-Dann/cinema-white-label` › **Root Directory: `backend`** › Environment Variables:

| Name | Value |
|---|---|
| `DATABASE_URL` | the transaction pooler URI from step 1, ending `?pgbouncer=true&connection_limit=1` |
| `DIRECT_URL` | the session pooler URI from step 1 (migrations only) |
| `AUTH_SECRET` | a long random string (on a Mac: `openssl rand -hex 32`) |
| `ALLOW_SIMULATED_PAYMENTS` | `true` (demo payments; no money moves) |
| `RUN_DB_DEPLOY` | `true` (migrate on production deploys, seed only when empty) |
| `ADMIN_ORIGINS` | `*.vercel.app` |

Deploy. The first build migrates and seeds the demo operators, films, screenings and the logins below. Check `https://<api-domain>/health` returns `{"status":"ok"}`.

## 3. Portal project

Vercel › Add New › Project › same repository › **Root Directory: `admin`** › Environment Variables:

| Name | Value |
|---|---|
| `NEXT_PUBLIC_API_BASE` | the API's production URL, e.g. `https://cinema-api-xxxx.vercel.app` |

Deploy, open the portal and sign in with `admin@northlight.example` / `operator-dev-password` (or `editor@…` / `editor-dev-password`). Change these before showing anyone outside the team.

## How it behaves on serverless

- Live seat updates use polling (every few seconds) instead of a held-open stream; the app already falls back to it.
- Expired holds are treated as free on every read; the background sweep only tidies up, so nothing depends on it.
- Scheduled config releases are promoted when the config is read.
- Film artwork is served from the bundled fixtures. Images uploaded in the portal are stored in `/tmp` and can disappear when the function restarts. Production should use object storage behind `MediaStorage` (S3, R2 or Vercel Blob).
- Preview deployments share the production database, so they do not run migrations: an unmerged branch could otherwise change the live schema. To migrate from a preview (a preview with its own database), set `RUN_DB_DEPLOY_PREVIEW=true` for the Preview environment. Give previews their own database before real customers use it.

## Builds only for what changed

The three Vercel projects (marketing site, API, portal) share one account, and the free plan allows 100 deployments a day. Each project's `vercel.json` has an `ignoreCommand` that skips the build when nothing it depends on changed since that project's last deployment (`VERCEL_GIT_PREVIOUS_SHA`, or the previous commit on a first deploy):

| Project | Builds when these change |
|---|---|
| `site` | `site/` |
| `backend` | `backend/`, `packages/`, `shared/`, `pnpm-lock.yaml` |
| `admin` | `admin/`, `packages/`, `pnpm-lock.yaml` |

If the comparison can't run (an unknown commit), the build goes ahead. To force a build, use Redeploy in the Vercel dashboard.
