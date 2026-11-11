import { isDaySlot, Slot } from './calendar';

/** Food orders per admission when nothing is known yet. */
export const ATTACH_PRIOR = 0.35;
const K = 200;

export const certBand = (c: string) => (['U', 'PG'].includes(c) ? 'family' : ['12', '12A'].includes(c) ? 'teen' : 'adult');
export const timeBand = (s: Slot) => (isDaySlot(s) ? 'day' : 'evening');

/** Learned attach rates by certificate band and time of day, shrunk towards the prior. */
export function attachRates(rows: { certificate: string; slot: Slot; admissions: number; foodOrders: number }[]): Record<string, number> {
  const agg: Record<string, { a: number; f: number }> = {};
  for (const r of rows) {
    const k = `${certBand(r.certificate)}:${timeBand(r.slot)}`;
    agg[k] ??= { a: 0, f: 0 };
    agg[k].a += r.admissions;
    agg[k].f += r.foodOrders;
  }
  const out: Record<string, number> = {};
  for (const cb of ['family', 'teen', 'adult']) for (const tb of ['day', 'evening']) {
    const g = agg[`${cb}:${tb}`] ?? { a: 0, f: 0 };
    out[`${cb}:${tb}`] = Math.round(((g.f + K * ATTACH_PRIOR) / (g.a + K)) * 1000) / 1000;
  }
  return out;
}

export interface MixItem {
  productId: string;
  name: string;
  /** Units per food order. */
  perOrder: number;
}

/** Product mix: units of each product per food order, from recent order lines. */
export function productMix(lines: { productId: string; name: string; quantity: number; bookingId: string }[]): MixItem[] {
  const orders = new Set(lines.map((l) => l.bookingId)).size;
  if (!orders) return [];
  const by = new Map<string, { name: string; q: number }>();
  for (const l of lines) {
    const c = by.get(l.productId) ?? { name: l.name, q: 0 };
    c.q += l.quantity;
    by.set(l.productId, c);
  }
  return [...by.entries()].map(([productId, c]) => ({ productId, name: c.name, perOrder: Math.round((c.q / orders) * 1000) / 1000 })).sort((a, b) => b.perOrder - a.perOrder);
}

export function prepForShow(expected: number, certificate: string, slot: Slot, rates: Record<string, number>, mix: MixItem[]) {
  const rate = rates[`${certBand(certificate)}:${timeBand(slot)}`] ?? ATTACH_PRIOR;
  const orders = expected * rate;
  return {
    attachRate: rate,
    expectedOrders: Math.round(orders),
    items: mix.slice(0, 8).map((m) => ({ productId: m.productId, name: m.name, quantity: Math.round(orders * m.perOrder) })).filter((i) => i.quantity > 0),
  };
}
