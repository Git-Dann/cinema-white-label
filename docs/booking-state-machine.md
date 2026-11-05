# Booking state machine

## Seat (per screening) — `ScreeningSeat.state`
```
AVAILABLE ──hold──▶ HELD ──confirm──▶ SOLD
    ▲                 │
    └──expire/release─┘
BLOCKED (operator/maintenance) is never selectable.
```
A `HELD` row whose `heldUntil` has passed is treated as available by every read and by new holds, even before the sweeper runs.

## Hold — `SeatHold.status`
`ACTIVE → CONVERTED` (booking confirmed) · `ACTIVE → RELEASED` (customer left or replaced the hold) · `ACTIVE → EXPIRED` (sweeper).
- One active hold per customer per screening. A new hold request replaces it atomically and keeps the original expiry, so a hold cannot be extended indefinitely.
- Hold duration is per tenant (`holdDurationSeconds`, default 480).

## Booking — `Booking.status`
`PENDING_PAYMENT → CONFIRMED` · `PENDING_PAYMENT → CANCELLED` (confirmation failed after payment; payment voided) · `CONFIRMED → REFUNDED` (Phase 3).

## Checkout sequence
1. Validate hold (active, not expired, tickets cover exactly the held seats) and price on the server.
2. Create or reuse the `PENDING_PAYMENT` booking (unique per hold).
3. Take payment outside the DB transaction with key `{bookingId}-{attempt}`. A decline keeps the hold so the customer can retry.
4. In one transaction: lock the hold row, move the seats `HELD → SOLD` only where `holdId` matches, insert `BookingSeat` rows (partial unique index `(screeningId, seatId) WHERE active`), mark hold `CONVERTED`, booking `CONFIRMED`, issue admission ticket.
5. If step 4 fails, void/refund and mark the booking `CANCELLED`.

## Client error codes and recovery
| Code | HTTP | App recovery |
|---|---|---|
| `seats_unavailable` | 409 | Mark conflicted seats, explain which, offer "Remove" |
| `seat_rules` | 422 | Show the rule message (e.g. sofa pairs) |
| `hold_expired` / `hold_not_active` | 410 / 409 | Back to seats, refresh availability |
| `payment_declined` | 402 | Seats still reserved; retry with a new checkout key |
| network / timeout | – | Retry with the same idempotency key (never double-charges) |
