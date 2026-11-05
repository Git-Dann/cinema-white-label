# 0001 – Third-party dependencies

| Dependency | Where | Reason |
|---|---|---|
| NestJS, Prisma, PostgreSQL | backend | Specified stack; modules, DI, migrations, typed queries. |
| zod | contracts, backend | One schema gives runtime validation and TypeScript types across backend and admin. |
| sharp | backend | Image renditions, upload validation and re-encoding (strips metadata). |
| Next.js 15 / React 19 | admin | Specified stack. No UI component library. |
| Playwright (dev only, preinstalled) | scripts | Generates original fixture artwork; admin E2E checks. |
| iOS | — | None. Apple frameworks only (SwiftUI, Observation, MapKit, PassKit, EventKitUI, AVKit). |

Rejected for now: Redis (not needed until multiple API instances; see architecture.md), JWT libraries (HS256 implemented in ~40 lines with node:crypto), image libraries on iOS (URLCache + NSCache suffice).
