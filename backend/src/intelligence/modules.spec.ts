import { anomalies } from './anomalies';
import { basketRules } from './baskets';
import { demoBaskets, demoCustomers } from './demo';
import { attachRates, prepForShow, productMix } from './food';
import { scoreCustomers, segmentSummary } from './loyalty';
import { priceSuggestion } from './pricing';
import { PulseForecast } from './pulse';
import { alsoBooked, audiences, recommend } from './recommendations';
import { screenSwaps } from './screens';
import { roleKind, staffingPlan, tillsFor } from './staffing';

const fc = (over: Partial<PulseForecast>): PulseForecast => ({ screeningId: 's', expected: 50, low: 40, high: 60, capacity: 100, occupancy: 0.5, soldNow: 20, demand: 50, paceIndex: 1, paceBasis: 'live', soldThrough: 0.4, confidence: 'medium', baseline: { slot: 'weekday-evening', label: '', occupancy: 0.2 }, drivers: [], ...over });

describe('pricing', () => {
  it('raises full or fast-selling shows within 72 hours, and suggests off-peak for empty ones under a day out', () => {
    expect(priceSuggestion(fc({ occupancy: 0.9, expected: 90 }), 48)).toMatchObject({ action: 'raise', percent: 10 });
    expect(priceSuggestion(fc({ occupancy: 0.97 }), 10)?.percent).toBe(15);
    expect(priceSuggestion(fc({ occupancy: 0.65, paceIndex: 1.4 }), 30)?.action).toBe('raise');
    expect(priceSuggestion(fc({ occupancy: 0.35, paceIndex: 3 }), 30)).toBeNull();
    expect(priceSuggestion(fc({ occupancy: 0.9 }), 100)).toBeNull();
    expect(priceSuggestion(fc({ occupancy: 0.1 }), 6)).toMatchObject({ action: 'off-peak', percent: 25 });
    expect(priceSuggestion(fc({ occupancy: 0.9 }), 48, { maxRaisePercent: 5, maxDiscountPercent: 5 })?.percent).toBe(5);
    expect(priceSuggestion(fc({ occupancy: 0.1 }), -1)).toBeNull();
  });
});

describe('screens', () => {
  it('suggests moving a sell-out to a bigger, emptier screen nearby', () => {
    const t = new Date('2026-11-14T18:10:00Z');
    const swaps = screenSwaps([
      { forecast: fc({ screeningId: 'a', capacity: 41, expected: 41, demand: 70 }), screeningId: 'a', auditoriumId: 'small', screenName: 'Screen 3', filmTitle: 'Godzilla', startsAt: t },
      { forecast: fc({ screeningId: 'b', capacity: 140, expected: 30, demand: 30 }), screeningId: 'b', auditoriumId: 'big', screenName: 'Screen 1', filmTitle: 'Quiet', startsAt: new Date(t.getTime() + 20 * 60_000) },
      { forecast: fc({ screeningId: 'c', capacity: 200, expected: 20 }), screeningId: 'c', auditoriumId: 'huge', screenName: 'Screen 2', filmTitle: 'Late', startsAt: new Date(t.getTime() + 3 * 3_600_000) },
    ]);
    expect(swaps).toHaveLength(1);
    expect(swaps[0].to.screeningId).toBe('b');
    expect(swaps[0].extraAdmissions).toBe(29);
    expect(swaps[0].reason).toContain('Screen 3');
  });
});

describe('staffing', () => {
  it('turns forecast arrivals into tills and ushers and finds rota gaps', () => {
    expect(tillsFor(0)).toBe(0);
    expect(tillsFor(64)).toBe(2);
    expect(roleKind('Concessions')).toBe('till');
    expect(roleKind('Usher, screens 1 to 4')).toBe('usher');
    expect(roleKind('Duty manager')).toBe('other');
    const start = new Date('2026-11-14T19:00:00Z');
    const w = staffingPlan([{ startsAt: start, expected: 200 }], [{ role: 'Box office', startsAt: new Date('2026-11-14T17:00:00Z'), endsAt: new Date('2026-11-14T23:00:00Z') }], (d) => d.toISOString().slice(11, 16));
    const peak = w.find((x) => x.from === '18:30')!;
    expect(peak.arrivals).toBe(120);
    expect(peak.tillsNeeded).toBe(4);
    expect(peak.tillsRostered).toBe(1);
    expect(peak.short).toContain('3 on tills');
    expect(w.reduce((a, x) => a + x.arrivals, 0)).toBe(200);
  });
});

describe('food', () => {
  it('learns attach rates with shrinkage and preps per show', () => {
    const rates = attachRates([{ certificate: 'PG', slot: 'weekend-day', admissions: 1000, foodOrders: 600 }]);
    expect(rates['family:day']).toBeGreaterThan(0.5);
    expect(rates['adult:evening']).toBe(0.35);
    const mix = productMix([
      { productId: 'p', name: 'Popcorn', quantity: 2, bookingId: 'b1' },
      { productId: 'd', name: 'Drink', quantity: 1, bookingId: 'b1' },
      { productId: 'p', name: 'Popcorn', quantity: 1, bookingId: 'b2' },
    ]);
    expect(mix[0]).toMatchObject({ name: 'Popcorn', perOrder: 1.5 });
    const prep = prepForShow(100, 'PG', 'weekend-day', rates, mix);
    expect(prep.expectedOrders).toBe(Math.round(100 * rates['family:day']));
    expect(prep.items[0].name).toBe('Popcorn');
  });
});

describe('baskets', () => {
  it('finds pairs bought together more than chance', () => {
    const orders = [...Array(40).fill(['Nachos', 'Large drink']), ...Array(40).fill(['Popcorn']), ...Array(20).fill(['Large drink'])];
    const rules = basketRules(orders);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ items: ['Nachos', 'Large drink'], support: 0.4, confidence: 1 });
    expect(rules[0].lift).toBeCloseTo(1.67, 1);
    expect(rules[0].suggestion).toContain('bundle');
    expect(basketRules([])).toEqual([]);
    expect(basketRules(demoBaskets(['Sweet popcorn', 'Soft drink', 'Nachos', 'Hot dog', 'Chocolate', 'Water'])).length).toBeGreaterThan(1);
  });
});

describe('loyalty', () => {
  const now = new Date('2026-11-12T12:00:00Z');
  const days = (n: number) => new Date(now.getTime() - n * 86400_000);
  it('scores recency, frequency and spend, segments customers and flags churn risk', () => {
    const scores = scoreCustomers(
      [
        { customerId: 'champ', visits: [1, 10, 20, 30, 40, 50].map((d) => ({ at: days(d), spendMinor: 4000, familyMatinee: false })) },
        { customerId: 'lapsing', visits: [60, 70, 80].map((d) => ({ at: days(d), spendMinor: 1500, familyMatinee: false })) },
        { customerId: 'new', visits: [{ at: days(5), spendMinor: 1200, familyMatinee: false }] },
        { customerId: 'lost', visits: [{ at: days(300), spendMinor: 1200, familyMatinee: false }] },
        { customerId: 'family', visits: [20, 50].map((d) => ({ at: days(d), spendMinor: 1000, familyMatinee: true })) },
      ],
      now,
    );
    const by = Object.fromEntries(scores.map((s) => [s.customerId, s]));
    expect(by.champ.segment).toBe('Champions');
    expect(by.lapsing.segment).toBe('Lapsing');
    expect(by.lapsing.churnRisk).toBeGreaterThanOrEqual(2);
    expect(by.new.segment).toBe('New');
    expect(by.lost.segment).toBe('Lost');
    expect(by.family.segment).toBe('Family matinee');
    const summary = segmentSummary(scores);
    expect(summary.reduce((a, s) => a + s.customers, 0)).toBe(5);
    expect(segmentSummary(scoreCustomers(demoCustomers(now), now)).filter((s) => s.customers > 0).length).toBeGreaterThanOrEqual(5);
  });
});

describe('recommendations', () => {
  const a = { id: 'a', title: 'Alpha', genres: ['Action'], certificate: '12A' };
  const b = { id: 'b', title: 'Beta', genres: ['Action', 'Thriller'], certificate: '12A' };
  const c = { id: 'c', title: 'Gamma', genres: ['Romance'], certificate: '15' };
  const aud = audiences([
    { customerId: '1', filmId: 'a' },
    { customerId: '1', filmId: 'c' },
    { customerId: '2', filmId: 'a' },
    { customerId: '2', filmId: 'c' },
  ]);
  it('recommends co-booked films first, then similar ones, and popular ones with no history', () => {
    const recs = recommend([a], [a, b, c], aud, new Map([['b', 10]]));
    expect(recs.map((r) => r.film.id)).toEqual(['c', 'b']);
    expect(recs[0].reason).toBe('People who booked Alpha also booked this');
    expect(recs[1].reason).toContain('Like Alpha');
    const cold = recommend([], [b, c], aud, new Map([['b', 10], ['c', 2]]));
    expect(cold[0].film.id).toBe('b');
    expect(cold[0].reason).toBe('Popular at your cinema right now');
    expect(alsoBooked(a, [a, b, c], aud)[0].film.id).toBe('c');
  });
});

describe('anomalies', () => {
  it('flags days far from forecast with a robust z-score', () => {
    const days = Array.from({ length: 14 }, (_, i) => ({ venueId: 'v', venueName: 'Leeds', date: `2026-11-${String(i + 1).padStart(2, '0')}`, actual: 100 + (i % 3) * 5, forecast: 100 }));
    days[6].actual = 190;
    const found = anomalies(days);
    expect(found).toHaveLength(1);
    expect(found[0].date).toBe('2026-11-07');
    expect(found[0].sentence).toContain('above forecast');
    expect(anomalies(days.slice(0, 3))).toEqual([]);
  });
});
