# Integrations

Seatfold connects to the systems an operator already runs through two narrow doors.
Nothing else is open: customer contact details, payment data and admin actions are
never reachable from outside.

| Door | Direction | Who uses it |
|---|---|---|
| **Partner API** (`/v1/partner`) with scoped API keys | In and out, pulled by the partner | Rota systems, BI tools, data warehouses, accounting |
| **Webhooks** | Out, pushed by us | Automation (Zapier, Make), email tools, the operator's own systems |

Payments and ticketing are different: they are provider adapters inside the API (see
[Payments](#payments) and [Ticketing](#ticketing)), not open endpoints.

Operators manage all of this in the portal under **Setup › Connections**.

## API keys

- Created by an operator admin, shown **once** (`sf_live_…`). Only a SHA-256 hash is stored.
- Each key carries scopes. A key can only do what its scopes say; it is read-only unless a write scope is given.
- The key decides the operator. There is no tenant in the URL or body.
- Revoking a key stops it at once. "Last used" is recorded (at most once a minute).
- One key per system, so one can be revoked without touching the others.

```
Authorization: Bearer sf_live_…
```

| Scope | Gives |
|---|---|
| `films:read` | Films, artwork, cast and details |
| `venues:read` | Cinemas and their screens |
| `screenings:read` | Showtimes with seats sold and capacity |
| `bookings:read` | Sales: bookings with amounts. Never customer name, email or payment details |
| `shifts:read` | Shifts at each cinema |
| `shifts:write` | Add, update and remove shifts (rota systems) |

### Endpoints

| Method and path | Scope | Notes |
|---|---|---|
| `GET /v1/partner/films` | `films:read` | Visible films only |
| `GET /v1/partner/venues` | `venues:read` | With screens |
| `GET /v1/partner/screenings?from&to&venueId` | `screenings:read` | ISO dates; up to 92 days per call; default next 7 days |
| `GET /v1/partner/bookings?from&to&venueId&after` | `bookings:read` | By confirmation time, 500 a page, `next` cursor; default last 7 days |
| `GET /v1/partner/shifts?from&to&venueId` | `shifts:read` | Default next 14 days |
| `PUT /v1/partner/shifts` | `shifts:write` | Upsert by `(source, externalId)`; up to 500 a call |
| `DELETE /v1/partner/shifts/{source}/{externalId}` | `shifts:write` | |

The full reference is the OpenAPI document at `/docs` (tag **Partner**).

## Rota systems

Planday, Deputy, RotaCloud or anything else sends shifts with a `shifts:write` key:

```json
PUT /v1/partner/shifts
{
  "source": "planday",
  "shifts": [
    { "externalId": "pd-8812", "venueId": "…", "staffName": "Sam Usher", "staffEmail": "sam@…",
      "role": "Concessions", "startsAt": "2026-11-14T17:00:00Z", "endsAt": "2026-11-14T23:00:00Z" }
  ]
}
```

Re-sending the same rota is safe. Shifts are only accepted for the key's own cinemas.
They appear in **My week** (a person sees their own when `staffEmail` matches their
login, otherwise the cinema's) and in **On shift** on **Today**. Most rota tools can
push through their own webhooks or a Zapier step; the other way, the staffing forecast
(Next 6 weeks) can be copied into the rota today and becomes an endpoint next.

## Webhooks

- HTTPS only. Local, private-network and credential-bearing URLs are refused.
- Events: `booking.confirmed`, `booking.refunded`, `shifts.updated` (and `ping` from **Send test**).
- Body: `{ "id": "evt_…", "type": "booking.confirmed", "createdAt": "…", "data": { … } }`.
  Booking data is the same partner view as `GET /bookings`: no customer details.
- Headers: `Seatfold-Event`, `Seatfold-Event-Id` and
  `Seatfold-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "{t}.{body}" with the webhook secret>`.
  Receivers should recompute the signature, reject timestamps older than five minutes
  and ignore event ids they have already seen.
- Delivery: one immediate retry on a network error or 5xx, four-second timeout. Every
  attempt is logged; failed ones can be resent from the portal with the same event id.
- A webhook never delays or undoes a booking.

The secret is shown once when the webhook is created.

## Payments

`PaymentProvider` (backend/src/payments/payment.provider.ts) is the seam. Today the
simulated provider is in use and every booking says so. A real provider (Stripe, Adyen or
Worldpay) is one class implementing `authoriseAndCapture` and `voidOrRefund` with Apple
Pay tokens, enabled per operator once they have a merchant account. Card details never
reach Seatfold.

## Ticketing

Seatfold is the customer app and portal; it works beside the operator's ticketing system
(Vista, Veezi, Admit One). An adapter that keeps showtimes, seats and sales in step is
written once the operator gives licensed access. Until then Seatfold is the source of truth.

## Limits and next steps

- Rate limiting per key is not in place yet; it belongs at the edge (Vercel firewall) or
  as a token bucket per key before a public launch.
- Webhook delivery is in-request with a retry. At volume it moves to an outbox table
  drained by a queue worker, so retries can back off over hours.
- Planned endpoints: staffing forecast (`staffing:read`), daily sales summary for
  accounting, and food orders to prepare per screening for kitchen screens.
