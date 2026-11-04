# Architecture

## Overview
```
iOS app (SwiftUI)          Admin portal (Next.js)
      │ HTTPS /v1/t/{tenant}       │ HTTPS /v1/admin
      └──────────────┬─────────────┘
              NestJS modular monolith
   tenants · catalogue · media · venues · screenings
   holds · pricing · bookings · payments · wallet · analytics · admin
                     │
                PostgreSQL (authoritative)
```

## Key decisions
| Decision | Why |
|---|---|
| Modular monolith (NestJS) | One deployable while domains settle; module boundaries mirror future services. |
| PostgreSQL row locks for holds, not Redis | Seat inventory must be transactional. `SELECT … FOR UPDATE` in a stable order plus a partial unique index on active `BookingSeat` rows guarantees no double sale even if application logic is wrong. Redis is optional (cache / pub-sub fan-out), never the authority. |
| Lazy + swept hold expiry | Reads treat `heldUntil <= now` as available immediately; a 15s sweeper tidies rows and notifies clients. Expiry never depends on a background job running on time. |
| Payment outside DB transactions | Pending booking → provider call (idempotency key = booking id + attempt) → confirm transaction. If confirmation fails after capture, the payment is voided/refunded. |
| Idempotency table | `Idempotency-Key` on holds and checkout; deterministic outcomes are replayed, key reuse with a different body is rejected. |
| Shared contracts package | zod schemas give runtime validation on the backend and types for admin; Swift mirrors are tested against the same JSON fixtures. |
| Resolved theme tokens in config | The backend resolves theme × palette into tokens and validates contrast before publishing; apps never need a resolver and re-validate defensively. |
| CinemaCore is Foundation-only | All business logic (geometry, hit-testing, selection rules, booking state machine, config store) builds and tests on Linux and macOS. SwiftUI targets are thin. |
| XcodeGen | Reviewable project definition; per-operator schemes from xcconfig files. |

## Scaling availability updates
`AvailabilityEvents` is an in-process emitter feeding SSE streams. With more than one API instance, publish changes to Redis pub/sub (channel per screening) and subscribe in each instance. Clients already fall back to polling the availability endpoint if the stream drops.

## Tenancy
Customer routes carry the tenant slug in the path; `TenantGuard` resolves it once per request and services always filter by `tenantId`. Customer tokens embed the tenant id and are rejected on any other tenant. Admin tokens carry role and tenant; only `PLATFORM_ADMIN` crosses tenants.

## Security defaults
HMAC-signed tokens (HS256, secret from env), scrypt password hashing, Keychain storage on iOS, uploads decoded and re-encoded with sharp (metadata stripped, dimension limits), analytics allow-list with PII key stripping, signed admission barcodes, secrets outside source control. Known gaps are listed in `TASKS.md`.
