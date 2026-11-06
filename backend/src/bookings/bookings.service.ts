import { Inject, Injectable, Logger } from '@nestjs/common';
import { Prisma, Tenant } from '@prisma/client';
import { AuditoriumLayout } from '@cinema/contracts';
import { randomBytes } from 'crypto';
import { imageRef, pickAsset } from '../catalogue/film-dto';
import { Clock } from '../common/clock';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { zonedDate } from '../common/time';
import { signAdmission } from '../common/tokens';
import { PAYMENT_PROVIDER, PaymentProvider } from '../payments/payment.provider';
import { PricingService, TicketSelection } from '../pricing/pricing.service';
import { AvailabilityEvents } from '../screenings/availability.events';
import { WALLET_ISSUER, WalletPassIssuer } from '../wallet/wallet.issuer';
import { CommerceService, ConcessionLine, ConcessionSelection, venueFeatures } from '../commerce/commerce.service';
import { LoyaltyService, MembershipService, PointsMath, programDto } from '../loyalty/loyalty.service';

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function bookingReference(): string {
  const b = randomBytes(8);
  return Array.from(b.subarray(0, 7), (x) => REF_ALPHABET[x % REF_ALPHABET.length]).join('');
}

export interface BasketExtras {
  concessions?: ConcessionSelection[];
  voucherCode?: string;
  fulfilment?: 'collect' | 'seatDelivery';
  /** Loyalty points to spend, in whole-pound steps. */
  loyaltyPoints?: number;
}

/** Food and drink can be pre-ordered until this long before the film starts. */
export const PREORDER_CUTOFF_MINUTES = 15;

export interface AddOnInput {
  concessions: ConcessionSelection[];
  fulfilment?: 'collect' | 'seatDelivery';
}

export interface CheckoutInput extends BasketExtras {
  holdId: string;
  tickets: TicketSelection[];
  payment: { type: 'simulated'; outcome?: 'approve' | 'decline' };
}

function loyaltyFields(q: { membership: { planName: string; discountMinor: number } | null; loyalty: { pointsRedeemed: number; pointsDiscountMinor: number; pointsToEarn: number } | null }) {
  return {
    membershipDiscountMinor: q.membership?.discountMinor ?? 0,
    membershipPlanName: q.membership?.planName ?? null,
    pointsRedeemed: q.loyalty?.pointsRedeemed ?? 0,
    pointsDiscountMinor: q.loyalty?.pointsDiscountMinor ?? 0,
    pointsEarned: q.loyalty?.pointsToEarn ?? 0,
  };
}

const bookingInclude = {
  seats: { where: { active: true } },
  tickets: true,
  payments: true,
  walletPass: true,
  concessions: true,
  refunds: true,
  tenant: { select: { cancellationCutoffMinutes: true } },
  screening: { include: { film: { include: { assets: true } }, venue: true, auditorium: true } },
} satisfies Prisma.BookingInclude;
type BookingWithAll = Prisma.BookingGetPayload<{ include: typeof bookingInclude }>;

/**
 * Checkout flow (see docs/booking-state-machine.md):
 *   1. Validate hold + price on the server, create/reuse a PENDING_PAYMENT booking.
 *   2. Take payment OUTSIDE any DB transaction, keyed by the booking id.
 *   3. Confirm in one transaction: lock hold, mark seats SOLD, insert BookingSeat
 *      rows (partial unique index is the final double-sell guard), CONFIRMED.
 *   4. If confirmation fails after payment, void/refund and report.
 */
@Injectable()
export class BookingsService {
  private readonly log = new Logger(BookingsService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly pricing: PricingService,
    private readonly events: AvailabilityEvents,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
    @Inject(WALLET_ISSUER) private readonly wallet: WalletPassIssuer,
    private readonly commerce: CommerceService,
    private readonly loyalty: LoyaltyService,
    private readonly memberships: MembershipService,
  ) {}

  private async loadHoldContext(tenant: Tenant, customerId: string, holdId: string) {
    const hold = await this.prisma.seatHold.findFirst({
      where: { id: holdId, tenantId: tenant.id, customerId },
      include: { screening: { include: { film: true, layoutVersion: true, venue: true } }, booking: true },
    });
    if (!hold) throw Errors.notFound('Reservation');
    return { hold, layout: hold.screening.layoutVersion.geometry as unknown as AuditoriumLayout };
  }

  async quote(tenant: Tenant, customerId: string, holdId: string, tickets: TicketSelection[], extras: BasketExtras = {}) {
    const { hold, layout } = await this.loadHoldContext(tenant, customerId, holdId);
    this.assertTicketsMatchHold(hold.seatIds, tickets);
    return this.fullQuote(tenant, customerId, hold.screening, layout, tickets, extras);
  }

  /**
   * Tickets + food and drink, then discounts in a fixed order, all priced on the server:
   *   1. membership benefits (ticket and food percentages, booking fee waiver)
   *   2. voucher, on the amounts after membership discounts
   *   3. loyalty points, in whole pounds, never below zero; booking fees are always paid in money
   * Points are earned on what is left to pay, excluding fees, times the membership multiplier.
   */
  private async fullQuote(
    tenant: Tenant,
    customerId: string,
    screening: Parameters<PricingService['quote']>[1] & { venue: import('@prisma/client').Venue },
    layout: AuditoriumLayout,
    tickets: TicketSelection[],
    extras: BasketExtras,
  ) {
    const base = await this.pricing.quote(tenant, screening, layout, tickets);
    const concessions: ConcessionLine[] = await this.commerce.priceConcessions(tenant.id, screening.venue, extras.concessions ?? []);
    const concessionsMinor = concessions.reduce((a, l) => a + l.lineTotalMinor, 0);
    const fulfilment = extras.fulfilment ?? 'collect';
    if (fulfilment === 'seatDelivery' && (!venueFeatures(screening.venue).seatDelivery || concessions.length === 0)) {
      throw Errors.validation('Seat delivery is not available for this order');
    }

    // 1. Membership
    const [member, program] = await Promise.all([this.memberships.active(tenant.id, customerId), this.loyalty.program(tenant.id)]);
    const ent = member?.entitlements;
    const memberTickets = ent ? Math.floor((base.subtotalMinor * ent.ticketDiscountPercent) / 100) : 0;
    const memberFood = ent ? Math.floor((concessionsMinor * ent.foodDiscountPercent) / 100) : 0;
    const feeWaivedMinor = ent?.bookingFeeWaived ? base.feesMinor : 0;
    const feesMinor = base.feesMinor - feeWaivedMinor;
    const membershipDiscountMinor = memberTickets + memberFood;

    // 2. Voucher
    const voucher = extras.voucherCode
      ? await this.commerce.voucherDiscount(tenant, extras.voucherCode, base.subtotalMinor - memberTickets, concessionsMinor - memberFood, screening.venue.id)
      : null;
    const voucherMinor = voucher?.discountMinor ?? 0;
    const goodsAfterDiscounts = base.subtotalMinor + concessionsMinor - membershipDiscountMinor - voucherMinor;

    // 3. Points
    if (extras.loyaltyPoints && !program) throw Errors.pointsInvalid('Points are not available');
    const balance = program ? await this.loyalty.balance(customerId) : 0;
    const points = program ? PointsMath.redeem(program, balance, extras.loyaltyPoints ?? 0, goodsAfterDiscounts) : { points: 0, discountMinor: 0 };
    const pointsToEarn = program ? PointsMath.earn(program, goodsAfterDiscounts - points.discountMinor, ent?.pointsMultiplier ?? 1) : 0;

    const discounts = [
      ...(membershipDiscountMinor ? [{ kind: 'membership', label: `${member!.plan.name} member discount`, amountMinor: membershipDiscountMinor }] : []),
      ...(voucher ? [{ kind: 'voucher', label: voucher.description, amountMinor: voucherMinor }] : []),
      ...(points.points ? [{ kind: 'points', label: `${points.points} points`, amountMinor: points.discountMinor }] : []),
    ];
    const discountMinor = membershipDiscountMinor + voucherMinor + points.discountMinor;
    return {
      ...base,
      feesMinor,
      feeLabel: feesMinor > 0 ? base.feeLabel : null,
      concessions,
      concessionsMinor,
      fulfilment,
      voucher: voucher ? { code: voucher.code, description: voucher.description, discountMinor: voucherMinor } : null,
      discounts,
      discountMinor,
      totalMinor: base.subtotalMinor + concessionsMinor + feesMinor - discountMinor,
      voucherId: voucher?.id ?? null,
      membership: member ? { planName: member.plan.name, discountMinor: membershipDiscountMinor, feeWaivedMinor } : null,
      loyalty: program
        ? {
            ...programDto(program),
            balance,
            pointsRedeemed: points.points,
            pointsDiscountMinor: points.discountMinor,
            pointsToEarn,
            maxRedeemablePoints: PointsMath.maxRedeemable(program, balance, goodsAfterDiscounts),
          }
        : null,
    };
  }

  private assertTicketsMatchHold(held: string[], tickets: TicketSelection[]) {
    const a = [...held].sort().join(',');
    const b = tickets.map((t) => t.seatId).sort().join(',');
    if (a !== b) throw Errors.validation('Tickets must cover exactly the reserved seats');
  }

  async checkout(tenant: Tenant, customerId: string, input: CheckoutInput) {
    const { hold, layout } = await this.loadHoldContext(tenant, customerId, input.holdId);
    if (hold.status === 'CONVERTED' && hold.booking) return this.get(tenant.id, customerId, hold.booking.id);
    if (hold.status !== 'ACTIVE') throw Errors.holdNotActive();
    if (hold.expiresAt <= this.clock.now()) throw Errors.holdExpired();
    this.assertTicketsMatchHold(hold.seatIds, input.tickets);
    if (input.payment.type === 'simulated' && process.env.NODE_ENV === 'production' && process.env.ALLOW_SIMULATED_PAYMENTS !== 'true') {
      throw Errors.validation('Simulated payments are disabled in production');
    }

    const quote = await this.fullQuote(tenant, customerId, hold.screening, layout, input.tickets, input);

    // 1. Pending booking (reused on retry after a decline).
    const booking =
      hold.booking ??
      (await this.prisma.booking.create({
        data: {
          tenantId: tenant.id, reference: bookingReference(), customerId, screeningId: hold.screeningId, holdId: hold.id, status: 'PENDING_PAYMENT',
          subtotalMinor: quote.subtotalMinor, concessionsMinor: quote.concessionsMinor, feesMinor: quote.feesMinor, discountMinor: quote.discountMinor, totalMinor: quote.totalMinor, currency: quote.currency,
          voucherCode: quote.voucher?.code ?? null, fulfilment: quote.fulfilment, ...loyaltyFields(quote),
        },
      }));
    if (booking.status === 'CONFIRMED') return this.get(tenant.id, customerId, booking.id);
    await this.prisma.booking.update({
      where: { id: booking.id },
      data: {
        subtotalMinor: quote.subtotalMinor, concessionsMinor: quote.concessionsMinor, feesMinor: quote.feesMinor, discountMinor: quote.discountMinor,
        totalMinor: quote.totalMinor, voucherCode: quote.voucher?.code ?? null, fulfilment: quote.fulfilment, ...loyaltyFields(quote),
      },
    });

    // 2. Payment, idempotent per booking + amount.
    const attempt = await this.prisma.payment.count({ where: { bookingId: booking.id } });
    const payment = await this.payments.authoriseAndCapture({
      amountMinor: quote.totalMinor,
      currency: quote.currency,
      idempotencyKey: `${booking.id}-${attempt}`,
      description: `${hold.screening.film.title} ${booking.reference}`,
      method: input.payment,
    });
    await this.prisma.payment.create({
      data: {
        tenantId: tenant.id, bookingId: booking.id, provider: payment.provider, providerRef: payment.providerRef,
        status: payment.status === 'approved' ? 'CAPTURED' : 'DECLINED', amountMinor: quote.totalMinor, currency: quote.currency,
        failureReason: payment.status === 'declined' ? payment.reason : null,
      },
    });
    if (payment.status === 'declined') throw Errors.paymentDeclined(payment.reason);

    // 3. Confirm seats.
    try {
      await this.prisma.$transaction(async (tx) => {
        const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text AS status FROM "SeatHold" WHERE "id" = ${hold.id} FOR UPDATE`;
        if (locked.status !== 'ACTIVE') throw Errors.holdNotActive();
        // Expired holds can still be honoured if nobody else has taken the seats.
        const sold = await tx.screeningSeat.updateMany({
          where: { screeningId: hold.screeningId, seatId: { in: hold.seatIds }, state: 'HELD', holdId: hold.id },
          data: { state: 'SOLD', bookingId: booking.id, heldUntil: null, version: { increment: 1 } },
        });
        if (sold.count !== hold.seatIds.length) throw Errors.seatsUnavailable(hold.seatIds);
        await tx.bookingSeat.createMany({
          data: quote.lines.map((l) => ({ bookingId: booking.id, screeningId: hold.screeningId, seatId: l.seatId, rowLabel: l.rowLabel, seatLabel: l.seatLabel, ticketTypeId: l.ticketTypeId, priceMinor: l.priceMinor })),
        });
        if (quote.concessions.length) {
          await tx.bookingConcession.createMany({
            data: quote.concessions.map((c) => ({ bookingId: booking.id, productId: c.productId, name: c.name, quantity: c.quantity, unitPriceMinor: c.unitPriceMinor, modifiers: c.modifiers, lineTotalMinor: c.lineTotalMinor })),
          });
        }
        if (quote.voucherId) {
          // Atomic redemption: fails if the last use was taken concurrently.
          const n = await tx.$executeRaw`UPDATE "Voucher" SET "redemptions" = "redemptions" + 1 WHERE "id" = ${quote.voucherId} AND ("maxRedemptions" IS NULL OR "redemptions" < "maxRedemptions")`;
          if (n !== 1) throw Errors.voucherInvalid('This code has already been fully used');
        }
        await this.loyalty.applyCheckout(tx, {
          tenantId: tenant.id, customerId, bookingId: booking.id, redeem: quote.loyalty?.pointsRedeemed ?? 0, earn: quote.loyalty?.pointsToEarn ?? 0,
          description: `${hold.screening.film.title} · ${booking.reference}`,
        });
        await tx.seatHold.update({ where: { id: hold.id }, data: { status: 'CONVERTED' } });
        await tx.booking.update({ where: { id: booking.id }, data: { status: 'CONFIRMED', confirmedAt: this.clock.now() } });
        await tx.admissionTicket.create({ data: { bookingId: booking.id, barcode: signAdmission(`CIN1.${booking.reference}.${booking.id}`) } });
      });
    } catch (e) {
      this.log.warn(`Confirmation failed after payment for booking ${booking.id}; voiding`);
      await this.payments.voidOrRefund(payment.providerRef, quote.totalMinor);
      await this.prisma.payment.updateMany({ where: { providerRef: payment.providerRef }, data: { status: 'REFUNDED' } });
      await this.prisma.booking.update({ where: { id: booking.id }, data: { status: 'CANCELLED' } });
      throw e;
    }

    this.events.publish({ screeningId: hold.screeningId, changes: hold.seatIds.map((seatId) => ({ seatId, state: 'sold' as const })) });
    return this.get(tenant.id, customerId, booking.id);
  }

  /**
   * Food and drink pre-ordered for a booking the customer already has, collected
   * at the counter (or brought to the seat where the cinema offers it). Priced on
   * the server with the member food discount; paid as its own payment on the booking.
   * Codes and points stay with the original checkout.
   */
  private async loadAddOnContext(tenant: Tenant, customerId: string, bookingId: string) {
    const b = await this.prisma.booking.findFirst({ where: { id: bookingId, tenantId: tenant.id, customerId }, include: { screening: { include: { venue: true, film: true } } } });
    if (!b) throw Errors.notFound('Booking');
    if (b.status !== 'CONFIRMED') throw Errors.validation('Food can only be added to a confirmed booking');
    const closes = b.screening.startsAt.getTime() - PREORDER_CUTOFF_MINUTES * 60000;
    if (this.clock.now().getTime() >= closes) throw Errors.validation(`Pre-orders close ${PREORDER_CUTOFF_MINUTES} minutes before the film starts. You can still buy at the counter.`);
    return b;
  }

  async quoteAddOn(tenant: Tenant, customerId: string, bookingId: string, input: AddOnInput) {
    const b = await this.loadAddOnContext(tenant, customerId, bookingId);
    return this.addOnQuote(tenant, customerId, b, input);
  }

  private async addOnQuote(tenant: Tenant, customerId: string, b: Awaited<ReturnType<BookingsService['loadAddOnContext']>>, input: AddOnInput) {
    if (!input.concessions.length) throw Errors.validation('Add at least one item');
    const venue = b.screening.venue;
    const lines = await this.commerce.priceConcessions(tenant.id, venue, input.concessions);
    const fulfilment = input.fulfilment ?? 'collect';
    if (fulfilment === 'seatDelivery' && !venueFeatures(venue).seatDelivery) throw Errors.validation('Seat delivery is not available at this cinema');
    const subtotalMinor = lines.reduce((a, l) => a + l.lineTotalMinor, 0);
    const [member, program] = await Promise.all([this.memberships.active(tenant.id, customerId), this.loyalty.program(tenant.id)]);
    const memberFood = member ? Math.floor((subtotalMinor * member.entitlements.foodDiscountPercent) / 100) : 0;
    const totalMinor = subtotalMinor - memberFood;
    const pointsToEarn = program ? PointsMath.earn(program, totalMinor, member?.entitlements.pointsMultiplier ?? 1) : 0;
    return {
      bookingId: b.id,
      concessions: lines,
      subtotalMinor,
      discounts: memberFood ? [{ kind: 'membership', label: `${member!.plan.name} member discount`, amountMinor: memberFood }] : [],
      discountMinor: memberFood,
      totalMinor,
      currency: b.currency,
      fulfilment,
      pointsToEarn,
      collectBy: b.screening.startsAt.toISOString(),
    };
  }

  async addConcessions(tenant: Tenant, customerId: string, bookingId: string, input: AddOnInput & { payment: CheckoutInput['payment'] }) {
    if (input.payment.type === 'simulated' && process.env.NODE_ENV === 'production' && process.env.ALLOW_SIMULATED_PAYMENTS !== 'true') {
      throw Errors.validation('Simulated payments are disabled in production');
    }
    const b = await this.loadAddOnContext(tenant, customerId, bookingId);
    const q = await this.addOnQuote(tenant, customerId, b, input);
    const attempt = await this.prisma.payment.count({ where: { bookingId: b.id } });
    const payment = await this.payments.authoriseAndCapture({
      amountMinor: q.totalMinor, currency: q.currency, idempotencyKey: `${b.id}-food-${attempt}`, description: `Food pre-order ${b.reference}`, method: input.payment,
    });
    await this.prisma.payment.create({
      data: {
        tenantId: tenant.id, bookingId: b.id, provider: payment.provider, providerRef: payment.providerRef, status: payment.status === 'approved' ? 'CAPTURED' : 'DECLINED',
        amountMinor: q.totalMinor, currency: q.currency, failureReason: payment.status === 'declined' ? payment.reason : null,
      },
    });
    if (payment.status === 'declined') throw Errors.paymentDeclined(payment.reason);
    try {
      await this.prisma.$transaction(async (tx) => {
        // The booking must still be live: a cancellation in the meantime refunds this payment below.
        const [locked] = await tx.$queryRaw<{ status: string }[]>`SELECT "status"::text AS status FROM "Booking" WHERE "id" = ${b.id} FOR UPDATE`;
        if (locked.status !== 'CONFIRMED') throw Errors.validation('This booking is no longer active');
        await tx.bookingConcession.createMany({
          data: q.concessions.map((c) => ({ bookingId: b.id, productId: c.productId, name: c.name, quantity: c.quantity, unitPriceMinor: c.unitPriceMinor, modifiers: c.modifiers, lineTotalMinor: c.lineTotalMinor })),
        });
        await tx.booking.update({
          where: { id: b.id },
          data: {
            concessionsMinor: { increment: q.subtotalMinor }, membershipDiscountMinor: { increment: q.discountMinor }, discountMinor: { increment: q.discountMinor },
            totalMinor: { increment: q.totalMinor }, pointsEarned: { increment: q.pointsToEarn }, ...(q.fulfilment === 'seatDelivery' ? { fulfilment: 'seatDelivery' } : {}),
          },
        });
        await this.loyalty.applyCheckout(tx, { tenantId: tenant.id, customerId, bookingId: b.id, redeem: 0, earn: q.pointsToEarn, description: `Food pre-order · ${b.reference}` });
      });
    } catch (e) {
      this.log.warn(`Food pre-order failed after payment for booking ${b.id}; refunding`);
      await this.payments.voidOrRefund(payment.providerRef, q.totalMinor);
      await this.prisma.payment.updateMany({ where: { providerRef: payment.providerRef }, data: { status: 'REFUNDED' } });
      throw e;
    }
    return this.get(tenant.id, customerId, b.id);
  }

  async list(tenantId: string, customerId: string) {
    const rows = await this.prisma.booking.findMany({
      where: { tenantId, customerId, status: { in: ['CONFIRMED', 'CANCELLED', 'REFUNDED'] } },
      include: bookingInclude,
      orderBy: { screening: { startsAt: 'asc' } },
    });
    return rows.map((b) => this.dto(b));
  }

  async get(tenantId: string, customerId: string, bookingId: string) {
    const b = await this.prisma.booking.findFirst({ where: { id: bookingId, tenantId, customerId }, include: bookingInclude });
    if (!b) throw Errors.notFound('Booking');
    return this.dto(b);
  }

  private dto(b: BookingWithAll) {
    const s = b.screening;
    const now = this.clock.now();
    const payment = b.payments.find((p) => p.status === 'CAPTURED') ?? b.payments[b.payments.length - 1];
    return {
      id: b.id,
      reference: b.reference,
      status: b.status,
      createdAt: b.createdAt.toISOString(),
      confirmedAt: b.confirmedAt?.toISOString() ?? null,
      screening: {
        id: s.id, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), localDate: zonedDate(s.startsAt, s.venue.timeZone),
        formats: s.formats, attributes: s.attributes,
      },
      film: { id: s.film.id, title: s.film.title, certificate: s.film.certificate, runtimeMinutes: s.film.runtimeMinutes, poster: imageRef(pickAsset(s.film.assets, 'POSTER', now)), backdrop: imageRef(pickAsset(s.film.assets, 'BACKDROP', now)) },
      venue: { id: s.venue.id, name: s.venue.name, timeZone: s.venue.timeZone, address: { line1: s.venue.addressLine1, city: s.venue.city, postcode: s.venue.postcode }, coordinate: { latitude: s.venue.latitude, longitude: s.venue.longitude } },
      auditorium: { id: s.auditorium.id, name: s.auditorium.name, screenNumber: s.auditorium.screenNumber },
      seats: b.seats.map((x) => ({ seatId: x.seatId, rowLabel: x.rowLabel, seatLabel: x.seatLabel, ticketTypeId: x.ticketTypeId, priceMinor: x.priceMinor })),
      totals: {
        currency: b.currency, subtotalMinor: b.subtotalMinor, concessionsMinor: b.concessionsMinor, feesMinor: b.feesMinor, discountMinor: b.discountMinor, totalMinor: b.totalMinor, voucherCode: b.voucherCode,
        membershipDiscountMinor: b.membershipDiscountMinor, membershipPlanName: b.membershipPlanName, pointsRedeemed: b.pointsRedeemed, pointsDiscountMinor: b.pointsDiscountMinor, pointsEarned: b.pointsEarned,
      },
      concessions: b.concessions.map((c) => ({ name: c.name, quantity: c.quantity, modifiers: (c.modifiers as { label: string }[]).map((m) => m.label), lineTotalMinor: c.lineTotalMinor })),
      fulfilment: b.fulfilment,
      preorder: {
        open: b.status === 'CONFIRMED' && now.getTime() < s.startsAt.getTime() - PREORDER_CUTOFF_MINUTES * 60000 && venueFeatures(s.venue).concessions,
        closesAt: new Date(s.startsAt.getTime() - PREORDER_CUTOFF_MINUTES * 60000).toISOString(),
      },
      cancellation: {
        cancelledAt: b.cancelledAt?.toISOString() ?? null,
        cancellableUntil: new Date(s.startsAt.getTime() - b.tenant.cancellationCutoffMinutes * 60000).toISOString(),
        canCancel: b.status === 'CONFIRMED' && now.getTime() < s.startsAt.getTime() - b.tenant.cancellationCutoffMinutes * 60000,
        refundedMinor: b.refunds.reduce((a, r) => a + r.amountMinor, 0),
      },
      payment: payment ? { provider: payment.provider, status: payment.status, isSimulated: payment.provider === 'simulated' } : null,
      admission: b.tickets[0] ? { barcode: b.tickets[0].barcode, format: 'qr' as const } : null,
      wallet: { available: this.wallet.signing, status: b.walletPass?.status ?? null },
    };
  }

  /**
   * Customer cancellation within the operator's cutoff. Refunds the captured
   * payment first; only then are seats released and the booking marked refunded.
   */
  async cancel(tenant: Tenant, customerId: string, bookingId: string) {
    const b = await this.prisma.booking.findFirst({ where: { id: bookingId, tenantId: tenant.id, customerId }, include: { payments: true, screening: true } });
    if (!b) throw Errors.notFound('Booking');
    if (b.status === 'REFUNDED' || b.status === 'CANCELLED') return this.get(tenant.id, customerId, b.id);
    if (b.status !== 'CONFIRMED') throw Errors.cancellationNotAllowed('This booking cannot be cancelled');
    const cutoff = b.screening.startsAt.getTime() - tenant.cancellationCutoffMinutes * 60000;
    if (this.clock.now().getTime() >= cutoff) {
      throw Errors.cancellationNotAllowed(`Bookings can be cancelled up to ${tenant.cancellationCutoffMinutes} minutes before the film starts`);
    }
    // Tickets and any food pre-orders were paid separately; refund each payment.
    const captured = b.payments.filter((p) => p.status === 'CAPTURED');
    for (const p of captured) await this.payments.voidOrRefund(p.providerRef, p.amountMinor);
    const seatIds = await this.prisma.$transaction(async (tx) => {
      const seats = await tx.bookingSeat.findMany({ where: { bookingId: b.id, active: true } });
      await tx.bookingSeat.updateMany({ where: { bookingId: b.id }, data: { active: false } });
      await tx.screeningSeat.updateMany({ where: { screeningId: b.screeningId, bookingId: b.id, state: 'SOLD' }, data: { state: 'AVAILABLE', bookingId: null, holdId: null, version: { increment: 1 } } });
      await tx.booking.update({ where: { id: b.id }, data: { status: 'REFUNDED', cancelledAt: this.clock.now() } });
      await this.loyalty.reverseBooking(tx, b);
      await tx.admissionTicket.updateMany({ where: { bookingId: b.id }, data: { status: 'VOID' } });
      await tx.walletPass.updateMany({ where: { bookingId: b.id }, data: { status: 'VOIDED' } });
      for (const p of captured) {
        await tx.payment.update({ where: { id: p.id }, data: { status: 'REFUNDED' } });
        await tx.refund.create({ data: { bookingId: b.id, paymentRef: p.providerRef, amountMinor: p.amountMinor, reason: 'customer_cancellation' } });
      }
      return seats.map((x) => x.seatId);
    });
    this.events.publish({ screeningId: b.screeningId, changes: seatIds.map((seatId) => ({ seatId, state: 'available' as const })) });
    return this.get(tenant.id, customerId, b.id);
  }

  async requestWalletPass(tenant: Tenant, customerId: string, bookingId: string) {
    const b = await this.prisma.booking.findFirst({ where: { id: bookingId, tenantId: tenant.id, customerId }, include: bookingInclude });
    if (!b) throw Errors.notFound('Booking');
    if (b.status !== 'CONFIRMED' || !b.tickets[0]) throw Errors.validation('Only confirmed bookings have tickets');
    const existing = b.walletPass;
    const serialNumber = existing?.serialNumber ?? `${tenant.slug}-${b.reference}`;
    const authenticationToken = existing?.authenticationToken ?? randomBytes(24).toString('hex');
    const passTypeIdentifier = `pass.example.${tenant.slug}.ticket`;
    const s = b.screening;
    const passJson = {
      formatVersion: 1,
      passTypeIdentifier,
      serialNumber,
      teamIdentifier: 'DEMO000000',
      organizationName: tenant.name,
      description: `${s.film.title} ticket`,
      relevantDate: s.startsAt.toISOString(),
      locations: [{ latitude: s.venue.latitude, longitude: s.venue.longitude, relevantText: `${s.film.title} at ${s.venue.name}` }],
      barcodes: [{ format: 'PKBarcodeFormatQR', message: b.tickets[0].barcode, messageEncoding: 'iso-8859-1', altText: b.reference }],
      eventTicket: {
        primaryFields: [{ key: 'film', label: 'FILM', value: s.film.title }],
        secondaryFields: [
          { key: 'screen', label: 'SCREEN', value: s.auditorium.name },
          { key: 'seats', label: 'SEATS', value: b.seats.map((x) => `${x.rowLabel}${x.seatLabel}`).join(', ') },
        ],
        auxiliaryFields: [{ key: 'starts', label: 'STARTS', value: s.startsAt.toISOString(), dateStyle: 'PKDateStyleMedium', timeStyle: 'PKDateStyleShort' }],
        backFields: [{ key: 'ref', label: 'Booking reference', value: b.reference }, { key: 'venue', label: 'Cinema', value: `${s.venue.name}, ${s.venue.addressLine1}, ${s.venue.city} ${s.venue.postcode}` }],
      },
    };
    const result = await this.wallet.issueEventTicket({ booking: b, serialNumber, authenticationToken, passJson });
    await this.prisma.walletPass.upsert({
      where: { bookingId: b.id },
      create: { bookingId: b.id, passTypeIdentifier, serialNumber, authenticationToken, status: result.status === 'issued' ? 'ISSUED' : 'DEMO_UNSIGNED' },
      update: { status: result.status === 'issued' ? 'ISSUED' : 'DEMO_UNSIGNED' },
    });
    return result;
  }
}
