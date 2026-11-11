export interface Visit {
  at: Date;
  spendMinor: number;
  /** Family film in a daytime slot. */
  familyMatinee: boolean;
}
export interface CustomerHistory {
  customerId: string;
  visits: Visit[];
}

export type Segment = 'Champions' | 'Regulars' | 'Family matinee' | 'New' | 'Lapsing' | 'Lost' | 'Occasional';
export const SEGMENT_INFO: Record<Segment, { description: string; action: string }> = {
  Champions: { description: 'Come often, recently, and spend the most.', action: 'Reward them: early booking for big releases, member perks.' },
  Regulars: { description: 'Steady visitors who come back on their usual rhythm.', action: 'Keep them: points boosts on quieter nights.' },
  'Family matinee': { description: 'Mostly family films in the daytime.', action: 'School holiday offers and kids combos.' },
  New: { description: 'First visit in the last 30 days.', action: 'A welcome offer for a second visit.' },
  Lapsing: { description: 'Overdue against their own usual gap between visits.', action: 'A personal nudge with a film they would like.' },
  Lost: { description: 'No visit for six months or more.', action: 'A win-back offer for a big release.' },
  Occasional: { description: 'Visit now and then.', action: 'Tell them what is on that suits them.' },
};

const DAY = 86400_000;
const quintile = (sorted: number[], v: number) => {
  if (sorted.length < 2) return 3;
  const rank = sorted.filter((x) => x <= v).length / sorted.length;
  return Math.min(5, Math.max(1, Math.ceil(rank * 5)));
};
const median = (xs: number[]) => {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

export interface CustomerScore {
  customerId: string;
  recency: number;
  frequency: number;
  monetary: number;
  daysSinceLast: number;
  visits: number;
  /** Days since last visit ÷ their median gap between visits (2 or more = at risk). Null with one visit. */
  churnRisk: number | null;
  segment: Segment;
}

/** Recency, frequency and spend scores (1 to 5, within this operator's customers), segments and churn risk. */
export function scoreCustomers(customers: CustomerHistory[], now: Date): CustomerScore[] {
  const rows = customers.filter((c) => c.visits.length).map((c) => {
    const vs = [...c.visits].sort((a, b) => a.at.getTime() - b.at.getTime());
    const last = vs[vs.length - 1].at;
    const daysSinceLast = Math.max(0, Math.floor((now.getTime() - last.getTime()) / DAY));
    const yearVisits = vs.filter((v) => now.getTime() - v.at.getTime() <= 365 * DAY);
    const gaps = vs.slice(1).map((v, i) => (v.at.getTime() - vs[i].at.getTime()) / DAY).filter((g) => g > 0);
    const churnRisk = gaps.length ? Math.round((daysSinceLast / Math.max(7, median(gaps))) * 100) / 100 : null;
    return { c, vs, daysSinceLast, freq: yearVisits.length, spend: yearVisits.reduce((a, v) => a + v.spendMinor, 0), churnRisk, family: vs.filter((v) => v.familyMatinee).length / vs.length };
  });
  const rec = rows.map((r) => -r.daysSinceLast).sort((a, b) => a - b);
  const fre = rows.map((r) => r.freq).sort((a, b) => a - b);
  const mon = rows.map((r) => r.spend).sort((a, b) => a - b);
  return rows.map((r) => {
    const R = quintile(rec, -r.daysSinceLast);
    const F = quintile(fre, r.freq);
    const M = quintile(mon, r.spend);
    let segment: Segment = 'Occasional';
    if (r.daysSinceLast >= 180) segment = 'Lost';
    else if (r.vs.length === 1 && r.daysSinceLast <= 30) segment = 'New';
    else if ((r.churnRisk ?? 0) >= 2) segment = 'Lapsing';
    else if (R >= 4 && F >= 4 && M >= 4) segment = 'Champions';
    else if (r.vs.length >= 2 && r.family >= 0.5) segment = 'Family matinee';
    else if (F >= 3 && R >= 3) segment = 'Regulars';
    return { customerId: r.c.customerId, recency: R, frequency: F, monetary: M, daysSinceLast: r.daysSinceLast, visits: r.vs.length, churnRisk: r.churnRisk, segment };
  });
}

export function segmentSummary(scores: CustomerScore[]) {
  const total = scores.length;
  const order: Segment[] = ['Champions', 'Regulars', 'Family matinee', 'New', 'Occasional', 'Lapsing', 'Lost'];
  return order.map((name) => {
    const n = scores.filter((s) => s.segment === name).length;
    return { name, customers: n, share: total ? Math.round((n / total) * 1000) / 1000 : 0, ...SEGMENT_INFO[name] };
  });
}
