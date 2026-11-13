# Seatfold marketing page

A one-page marketing site for the white-label cinema platform, built with the
[Taste Skill](https://www.tasteskill.dev/) (`design-taste-frontend`, installed via `skills-lock.json`).

Plain static HTML and CSS with no build step, no framework and no dependencies at runtime. Any static host works:
Cloudflare Pages, Vercel or Netlify.

## What is on it

| Section | What it shows | Source |
|---|---|---|
| Hero | The app in three brands; lead speaks to chains and independents | `js/hero-phones.js` |
| Who | Chains and independents, side by side | Product scope in `docs/` |
| Portal | The release history beside a draft release, with its palette and WCAG contrast checks | Live HTML matching `admin/` (Releases, Branding) |
| Booking | Seats, food, ticket: three real app captures that change as you scroll | `ci-screenshots` |
| Changes | What changes live vs what needs an App Store build | `docs/feature-parity.md` |
| Plan | Pulse, Today and My week, one tab per role | Portal captures at 3x (`img/portal-*.webp`, demo history, labelled) |
| Platform | What sits underneath, for whoever signs off the technology | `CLAUDE.md` rules, `backend/` |
| Seating | A live 226-seat map you can tap | `shared/fixtures/layouts/curved.json` |
| iPhone | Live Activity, offline ticket, Spotlight, VoiceOver list, Calendar | `docs/apple-integrations.md`, the app |
| Questions | What works today and what does not yet | `TASKS.md`, docs |

Every claim is taken from the repo. Things that are not built yet (ticketing adapters, Apple Pay,
signed Wallet passes, multi-brand) are described as not built yet.

## Run it locally

Any static server from this folder:

```bash
npx serve site
```

## Check it (the skill's checkers)

From the repo root, after reinstalling the skill if `.agents/` is missing (`npx skills add Leonxlnx/taste-skill`):

```bash
K=.agents/skills/design-taste-frontend
cd site
node ../$K/scripts/consistency.mjs index.html --widths 1440,1024,820,768,390 --rhythm-widths 1440,820,768,390 --page software --category "white-label cinema booking app" --primary "Book a demo"
node ../$K/assets/layout/check.mjs --url index.html --sizes 1440x900,1024x768,820x1180,768x1024,390x844 --shots shots/layout
node ../$K/scripts/perf.mjs index.html
```

## Deploy

Cloudflare Pages:

```bash
npx wrangler pages deploy site --project-name seatfold
```

Vercel: import the repo and set **Root Directory** to `site`, framework preset **Other**, no build command.

## Placeholders to replace

- **Name:** "Seatfold" is a coined placeholder (searches in `names.json`). Domain not checked.
- **Main action:** "Book a demo" opens `mailto:hello@seatfold.uk` (Cloudflare Email Routing forwards it).
- **Proof:** no customer logos, quotes or figures, because none exist yet. Add them once real operators sign up.
