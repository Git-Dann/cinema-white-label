# 0005: Integrations through scoped keys and signed webhooks

## Context

Operators need Seatfold to fit around their existing systems: rota tools, BI and data
warehouses, accounting, email and automation, payments and ticketing. We want to be easy
to connect without opening customer data or admin actions to anything that asks.

## Decision

- **One partner API** (`/v1/partner`) authenticated by operator-issued API keys. Keys are
  random, shown once and stored as SHA-256 hashes. Each key carries scopes from a fixed
  list; read-only unless a write scope is granted. The key, not the request, decides the operator.
- **Partner views exclude personal data.** Bookings expose amounts and screening details,
  never the customer. Admin endpoints are not reachable with a partner key.
- **Signed outgoing webhooks** (HMAC-SHA256 over timestamp and body, Stripe-style), HTTPS
  only, private addresses refused, every delivery logged and resendable.
- **Payments and ticketing stay adapters** inside the API (provider interfaces), chosen
  per operator, not generic endpoints.
- **No new dependencies**: Node crypto and fetch only.

## Consequences

- A rota system can be connected today with a `shifts:write` key; My week and Today use
  the real shifts.
- BI tools and warehouses can pull sales without seeing customers.
- Rate limiting and an outbox for webhook retries are follow-ups before a public launch
  (docs/integrations.md › Limits).
