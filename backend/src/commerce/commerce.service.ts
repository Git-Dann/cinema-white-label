import { Injectable } from '@nestjs/common';
import { ConcessionProduct, Tenant, Venue } from '@prisma/client';
import { z } from 'zod';
import { imageRef } from '../catalogue/film-dto';
import { Clock } from '../common/clock';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';

export interface ModifierGroup {
  id: string;
  name: string;
  min: number;
  max: number;
  options: { id: string; name: string; priceMinor: number }[];
}

export const concessionSelectionSchema = z.object({
  productId: z.string(),
  quantity: z.number().int().min(1).max(20),
  /** groupId → chosen option ids */
  modifiers: z.record(z.array(z.string())).default({}),
});
export type ConcessionSelection = z.infer<typeof concessionSelectionSchema>;

export interface ConcessionLine {
  productId: string;
  name: string;
  quantity: number;
  unitPriceMinor: number;
  modifiers: { groupId: string; optionIds: string[]; label: string; priceMinor: number }[];
  lineTotalMinor: number;
}

export interface VenueFeatures {
  concessions: boolean;
  seatDelivery: boolean;
}

/** Location-level flags override tenant defaults (see docs/theme-system.md). */
export function venueFeatures(venue: Pick<Venue, 'features'>): VenueFeatures {
  const f = (venue.features ?? {}) as Record<string, unknown>;
  return { concessions: f.concessions !== false, seatDelivery: f.seatDelivery === true };
}

/** Inside the product's sale window (either end may be open). */
export function onSale(p: Pick<ConcessionProduct, 'availableFrom' | 'availableUntil'>, now: Date): boolean {
  return (!p.availableFrom || p.availableFrom <= now) && (!p.availableUntil || p.availableUntil > now);
}

/**
 * Food and drink: venue menus, modifier validation and pricing, plus vouchers.
 * All totals are computed here; apps only display them.
 */
@Injectable()
export class CommerceService {
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock) {}

  async menu(tenantId: string, venueId: string) {
    const venue = await this.prisma.venue.findFirst({ where: { id: venueId, tenantId } });
    if (!venue) throw Errors.notFound('Cinema');
    const features = venueFeatures(venue);
    if (!features.concessions) return { features, categories: [] };
    const now = this.clock.now();
    const products = (
      await this.prisma.concessionProduct.findMany({
        where: { tenantId, OR: [{ venueId: null }, { venueId }] },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      })
    ).filter((p) => onSale(p, now));
    const [assets, films] = await Promise.all([
      this.prisma.mediaAsset.findMany({ where: { id: { in: products.map((p) => p.imageAssetId).filter((x): x is string => !!x) } } }),
      this.prisma.film.findMany({ where: { tenantId, id: { in: products.map((p) => p.filmId).filter((x): x is string => !!x) } }, select: { id: true, title: true } }),
    ]);
    const byCategory = new Map<string, unknown[]>();
    for (const p of products) {
      const list = byCategory.get(p.category) ?? [];
      list.push({
        id: p.id, sku: p.sku, name: p.name, description: p.description, priceMinor: p.priceMinor, allergens: p.allergens, dietary: p.dietary,
        calories: p.calories, stockStatus: p.available ? p.stockStatus : 'out', modifierGroups: p.modifierGroups, bundleItems: p.bundleItems,
        image: imageRef(assets.find((a) => a.id === p.imageAssetId)),
        featured: p.featured, badge: p.badge, limitedEdition: p.limitedEdition,
        // A "was" price is only shown when it really is higher.
        compareAtMinor: p.compareAtMinor !== null && p.compareAtMinor > p.priceMinor ? p.compareAtMinor : null,
        film: films.find((f) => f.id === p.filmId) ?? null,
        availableUntil: p.availableUntil?.toISOString() ?? null,
      });
      byCategory.set(p.category, list);
    }
    return { features, categories: [...byCategory].map(([name, items]) => ({ name, items })) };
  }

  async priceConcessions(tenantId: string, venue: Venue, selections: ConcessionSelection[]): Promise<ConcessionLine[]> {
    if (!selections.length) return [];
    if (!venueFeatures(venue).concessions) throw Errors.concessionUnavailable('Food and drink are not available at this cinema', selections.map((s) => s.productId));
    const products = await this.prisma.concessionProduct.findMany({ where: { tenantId, id: { in: selections.map((s) => s.productId) } } });
    const byId = new Map(products.map((p) => [p.id, p]));
    const unavailable = selections.filter((s) => {
      const p = byId.get(s.productId);
      return !p || !p.available || p.stockStatus === 'out' || (p.venueId !== null && p.venueId !== venue.id) || !onSale(p, this.clock.now());
    });
    if (unavailable.length) throw Errors.concessionUnavailable('Some items are no longer available', unavailable.map((s) => s.productId));
    return selections.map((s) => this.priceLine(byId.get(s.productId)!, s));
  }

  priceLine(p: ConcessionProduct, s: ConcessionSelection): ConcessionLine {
    const groups = (p.modifierGroups ?? []) as unknown as ModifierGroup[];
    const modifiers: ConcessionLine['modifiers'] = [];
    for (const g of groups) {
      const chosen = [...new Set(s.modifiers[g.id] ?? [])];
      if (chosen.length < g.min || chosen.length > g.max) {
        throw Errors.validation(`${p.name}: choose ${g.min === g.max ? g.min : `${g.min} to ${g.max}`} ${g.name.toLowerCase()}`);
      }
      const options = chosen.map((id) => {
        const o = g.options.find((x) => x.id === id);
        if (!o) throw Errors.validation(`${p.name}: unknown option for ${g.name}`);
        return o;
      });
      if (options.length) modifiers.push({ groupId: g.id, optionIds: chosen, label: options.map((o) => o.name).join(', '), priceMinor: options.reduce((a, o) => a + o.priceMinor, 0) });
    }
    const unknownGroups = Object.keys(s.modifiers).filter((k) => !groups.some((g) => g.id === k));
    if (unknownGroups.length) throw Errors.validation(`${p.name}: unknown options`);
    const unit = p.priceMinor + modifiers.reduce((a, m) => a + m.priceMinor, 0);
    return { productId: p.id, name: p.name, quantity: s.quantity, unitPriceMinor: unit, modifiers, lineTotalMinor: unit * s.quantity };
  }

  /** Validates a voucher and returns the discount. Redemption happens at confirmation. */
  async voucherDiscount(tenant: Tenant, code: string, ticketsMinor: number, concessionsMinor: number, venueId: string) {
    const v = await this.prisma.voucher.findUnique({ where: { tenantId_code: { tenantId: tenant.id, code: code.trim().toUpperCase() } } });
    const now = this.clock.now();
    if (!v || !v.active) throw Errors.voucherInvalid('This code is not recognised');
    if ((v.validFrom && v.validFrom > now) || (v.validTo && v.validTo < now)) throw Errors.voucherInvalid('This code has expired or is not valid yet');
    if (v.maxRedemptions !== null && v.redemptions >= v.maxRedemptions) throw Errors.voucherInvalid('This code has already been fully used');
    if (v.venueId && v.venueId !== venueId) {
      const only = await this.prisma.venue.findFirst({ where: { id: v.venueId, tenantId: tenant.id }, select: { name: true } });
      throw Errors.voucherInvalid(only ? `This code can only be used at ${only.name}` : 'This code is not valid at this cinema');
    }
    const scope = v.appliesTo === 'tickets' ? ticketsMinor : v.appliesTo === 'concessions' ? concessionsMinor : ticketsMinor + concessionsMinor;
    if (ticketsMinor + concessionsMinor < v.minSpendMinor) throw Errors.voucherInvalid(`Spend at least £${(v.minSpendMinor / 100).toFixed(2)} to use this code`);
    if (scope <= 0) throw Errors.voucherInvalid(v.appliesTo === 'concessions' ? 'This code applies to food and drink only' : 'This code does not apply to your basket');
    const discountMinor = v.kind === 'percentOff' ? Math.floor((scope * v.value) / 100) : Math.min(v.value, scope);
    return { id: v.id, code: v.code, description: v.description, discountMinor };
  }
}
