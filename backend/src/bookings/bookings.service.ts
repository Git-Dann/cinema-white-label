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

const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function bookingReference(): string {
  const b = randomBytes(8);
  return Array.from(b.subarray(0, 7), (x) => REF_ALPHABET[x % REF_ALPHABET.length]).join('');
}

export interface CheckoutInput {
  holdId: string;
  tickets: TicketSelection[];
  payment: { type: 'simulated'; outcome?: 'approve' | 'decline' };
}

const bookingInclude = {
  seats: { where: { active: true } },
  tickets: true,
  payments: true,
  walletPass: true,
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
  ) {}

  private async loadHoldContext(tenant: Tenant, customerId: string, holdId: string) {
    const hold = await this.prisma.seatHold.findFirst({
      where: { id: holdId, tenantId: tenant.id, customerId },
      include: { screening: { include: { film: true, layoutVersion: true } }, booking: true },
    });
    if (!hold) throw Errors.notFound('Reservation');
    return { hold, layout: hold.screening.layoutVersion.geometry as unknown as AuditoriumLayout };
  }

  async quote(tenant: Tenant, customerId: string, holdId: string, tickets: TicketSelection[]) {
    const { hold, layout } = await this.loadHoldContext(tenant, customerId, holdId);
    this.assertTicketsMatchHold(hold.seatIds, tickets);
    return this.pricing.quote(tenant, hold.screening, layout, tickets);
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

    const quote = await this.pricing.quote(tenant, hold.screening, layout, input.tickets);

    // 1. Pending booking (reused on retry after a decline).
    const booking =
      hold.booking ??
      (await this.prisma.booking.create({
        data: {
          tenantId: tenant.id, reference: bookingReference(), customerId, screeningId: hold.screeningId, holdId: hold.id, status: 'PENDING_PAYMENT',
          subtotalMinor: quote.subtotalMinor, feesMinor: quote.feesMinor, discountMinor: quote.discountMinor, totalMinor: quote.totalMinor, currency: quote.currency,
        },
      }));
    if (booking.status === 'CONFIRMED') return this.get(tenant.id, customerId, booking.id);
    await this.prisma.booking.update({ where: { id: booking.id }, data: { subtotalMinor: quote.subtotalMinor, feesMinor: quote.feesMinor, totalMinor: quote.totalMinor } });

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
      totals: { currency: b.currency, subtotalMinor: b.subtotalMinor, feesMinor: b.feesMinor, discountMinor: b.discountMinor, totalMinor: b.totalMinor },
      payment: payment ? { provider: payment.provider, status: payment.status, isSimulated: payment.provider === 'simulated' } : null,
      admission: b.tickets[0] ? { barcode: b.tickets[0].barcode, format: 'qr' as const } : null,
      wallet: { available: this.wallet.signing, status: b.walletPass?.status ?? null },
    };
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
