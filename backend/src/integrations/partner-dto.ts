import { Prisma } from '@prisma/client';

/** Booking as partners see it: what was sold and for how much, never who bought it. */
export const partnerBookingInclude = {
  screening: { include: { film: { select: { id: true, title: true, certificate: true } }, venue: { select: { id: true, name: true } }, auditorium: { select: { name: true } } } },
  seats: { select: { id: true, active: true } },
  tenant: { select: { currency: true } },
} satisfies Prisma.BookingInclude;
export type PartnerBookingRow = Prisma.BookingGetPayload<{ include: typeof partnerBookingInclude }>;

export function partnerBooking(b: PartnerBookingRow) {
  return {
    id: b.id,
    reference: b.reference,
    status: b.status,
    confirmedAt: b.confirmedAt?.toISOString() ?? null,
    cancelledAt: b.cancelledAt?.toISOString() ?? null,
    screening: {
      id: b.screeningId,
      startsAt: b.screening.startsAt.toISOString(),
      venue: b.screening.venue,
      screen: b.screening.auditorium.name,
      film: b.screening.film,
      formats: b.screening.formats,
    },
    tickets: b.seats.length,
    currency: b.tenant.currency,
    ticketsMinor: b.subtotalMinor,
    foodMinor: b.concessionsMinor,
    feesMinor: b.feesMinor,
    discountMinor: b.discountMinor,
    totalMinor: b.totalMinor,
  };
}
