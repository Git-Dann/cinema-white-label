# 0003 – Loyalty points and memberships

## Decision

- **Server-authoritative.** Points earned, points spent, member discounts and fee waivers are all calculated in the quote and applied at checkout. Apps show server values.
- **Discount order is fixed:** membership benefits, then voucher (on the discounted amounts), then points. Booking fees are always paid in money, never with points.
- **Points are earned on money paid**, excluding booking fees, times the membership multiplier, rounded down. They are credited when the booking is confirmed.
- **Points are spent in whole-pound steps** (`redeemPointsPerPound`), with an operator minimum. Spending is a conditional `UPDATE … WHERE points >= n` inside the confirmation transaction, and a database `CHECK (points >= 0)` backs it up. A failed spend voids the payment like any other confirmation failure.
- **Cancellation** gives back spent points and takes back earned ones. If the customer already spent what they earned, only the remaining balance is taken back; the ledger records the real amount. The balance never goes negative.
- **The ledger is append-only** (`LoyaltyLedgerEntry` with `balanceAfter`), so support can explain any balance.
- **Memberships are paid periods with manual renewal.** Renewing the same plan extends from the current end date. Switching plan waits until the current period ends. Plans that have been sold cannot be deleted, only turned off.

## Why manual renewal

Automatic renewal needs recurring billing from a real payment provider (stored payment method, renewal webhooks, failed-payment retries, dunning). The project rule is no fake integrations, so the simulated provider only takes one-off payments. When a PSP is added, `MembershipService.purchase` becomes the first charge and a renewal job extends `currentPeriodEnd` on successful charges.

## Known limitation: guest identity

Customers are currently guests tied to one device. Points and memberships bought on a device are lost with it. This is acceptable for demos and development, **not for production**: Sign in with Apple (or another account system) must ship before memberships take real money, and accounts must be able to adopt a guest's points and membership on first sign-in.

## Not included yet

- Free-ticket allowances (e.g. "4 films a month"): needs per-period usage tracking and rules for partially used allowances on cancellation.
- Tiers: `LoyaltyAccount.tier` exists but nothing sets it.
- Points expiry and manual adjustments by support staff.
- Gift cards remain modelled only, pending operator sign-off on stored-value rules.
