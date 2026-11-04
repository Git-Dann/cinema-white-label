import { Injectable } from '@nestjs/common';
import { Screening, Tenant } from '@prisma/client';
import { AuditoriumLayout } from '@cinema/contracts';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';

export interface TicketSelection {
  seatId: string;
  ticketTypeId: string;
}

export interface QuoteLine {
  seatId: string;
  rowLabel: string;
  seatLabel: string;
  ticketTypeId: string;
  ticketTypeName: string;
  priceCategory: string;
  baseMinor: number;
  supplementsMinor: number;
  priceMinor: number;
}

export interface Quote {
  currency: string;
  lines: QuoteLine[];
  subtotalMinor: number;
  feesMinor: number;
  discountMinor: number;
  totalMinor: number;
  feeLabel: string | null;
}

/** Ticket types not permitted for a BBFC certificate. Configurable per operator in Phase 3. */
const RESTRICTED_BY_CERTIFICATE: Record<string, string[]> = { '15': ['CHILD'], '18': ['CHILD'] };

/**
 * All prices are calculated here. Apps display server quotes and never
 * compute totals themselves. Amounts are integer minor units.
 */
@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async ticketTypesFor(tenant: Tenant, screening: Screening & { film: { certificate: string } }, layout: AuditoriumLayout) {
    const [types, supplements] = await Promise.all([
      this.prisma.ticketType.findMany({ where: { tenantId: tenant.id }, include: { priceRules: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.formatSupplement.findMany({ where: { tenantId: tenant.id, format: { in: screening.formats } } }),
    ]);
    const supplementMinor = supplements.reduce((a, s) => a + s.amountMinor, 0);
    const categories = [...new Set(layout.seats.map((s) => s.priceCategory))];
    const blocked = RESTRICTED_BY_CERTIFICATE[screening.film.certificate] ?? [];
    return {
      currency: tenant.currency,
      bookingFeePerTicketMinor: tenant.bookingFeeMinor,
      supplements: supplements.map((s) => ({ format: s.format, amountMinor: s.amountMinor })),
      ticketTypes: types
        .filter((t) => !blocked.includes(t.code))
        .map((t) => ({
          id: t.id,
          code: t.code,
          name: t.name,
          description: t.description,
          requiresProof: t.requiresProof,
          prices: Object.fromEntries(
            categories.map((c) => {
              const rule = t.priceRules.find((r) => r.priceCategory === c);
              return [c, rule ? rule.amountMinor + supplementMinor : null];
            }),
          ) as Record<string, number | null>,
        })),
    };
  }

  async quote(tenant: Tenant, screening: Screening & { film: { certificate: string } }, layout: AuditoriumLayout, selections: TicketSelection[]): Promise<Quote> {
    const seatById = new Map(layout.seats.map((s) => [s.id, s]));
    const rowLabel = new Map(layout.rows.map((r) => [r.id, r.label]));
    const types = await this.prisma.ticketType.findMany({ where: { tenantId: tenant.id }, include: { priceRules: true } });
    const typeById = new Map(types.map((t) => [t.id, t]));
    const supplements = await this.prisma.formatSupplement.findMany({ where: { tenantId: tenant.id, format: { in: screening.formats } } });
    const supplementsMinor = supplements.reduce((a, s) => a + s.amountMinor, 0);
    const blocked = RESTRICTED_BY_CERTIFICATE[screening.film.certificate] ?? [];

    const lines: QuoteLine[] = selections.map((sel) => {
      const seat = seatById.get(sel.seatId);
      if (!seat) throw Errors.validation(`Unknown seat ${sel.seatId}`);
      const type = typeById.get(sel.ticketTypeId);
      if (!type) throw Errors.validation('Unknown ticket type');
      if (blocked.includes(type.code)) throw Errors.validation(`${type.name} tickets are not available for ${screening.film.certificate} films`);
      const rule = type.priceRules.find((r) => r.priceCategory === seat.priceCategory);
      if (!rule) throw Errors.validation(`${type.name} tickets are not sold for ${seat.priceCategory} seats`);
      return {
        seatId: seat.id,
        rowLabel: rowLabel.get(seat.rowId) ?? seat.rowId,
        seatLabel: seat.label,
        ticketTypeId: type.id,
        ticketTypeName: type.name,
        priceCategory: seat.priceCategory,
        baseMinor: rule.amountMinor,
        supplementsMinor,
        priceMinor: rule.amountMinor + supplementsMinor,
      };
    });
    const subtotalMinor = lines.reduce((a, l) => a + l.priceMinor, 0);
    const feesMinor = tenant.bookingFeeMinor * lines.length;
    return {
      currency: tenant.currency,
      lines,
      subtotalMinor,
      feesMinor,
      discountMinor: 0,
      totalMinor: subtotalMinor + feesMinor,
      feeLabel: feesMinor > 0 ? 'Booking fee' : null,
    };
  }
}
