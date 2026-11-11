import { curveAt, expectedFromModel, FilmFacts, filmStrength, fitModel, forecast, OutcomeRow, popularityRanks, tmdbPopularityLicensed, prior, priorCurve, SLOT_BASE, TARGET_WEEKLY_OCCUPANCY, typicalWeekSlots, weeklyRetention } from './pulse';

const film = (over: Partial<FilmFacts> = {}): FilmFacts => ({ id: 'f1', title: 'Saltmarsh', genres: ['Drama'], certificate: '15', releaseDate: new Date('2026-10-02T00:00:00Z'), ...over });
const show = { venueId: 'v1', filmId: 'f1', capacity: 200, slot: 'fri-sat-evening' as const, dayOfWeek: 5, filmWeek: 1, formats: [], schoolHoliday: null };

describe('Pulse priors', () => {
  it('averages about 19% across a typical week, Fri/Sat evening highest and weekday daytime lowest', () => {
    const week = typicalWeekSlots();
    const avg = week.reduce((a, s) => a + SLOT_BASE[s], 0) / week.length;
    expect(avg).toBeCloseTo(TARGET_WEEKLY_OCCUPANCY, 2);
    expect(SLOT_BASE['fri-sat-evening']).toBeGreaterThan(SLOT_BASE['weekend-day']);
    expect(SLOT_BASE['weekday-day']).toBeLessThan(SLOT_BASE['weekday-evening']);
  });

  it('decays by genre, harder for big openings and summer releases', () => {
    expect(weeklyRetention(film({ genres: ['Comedy'] })).factor).toBe(0.55);
    expect(weeklyRetention(film({ genres: ['Action'] })).factor).toBe(0.42);
    expect(weeklyRetention(film({ genres: ['Horror'] })).factor).toBe(0.42);
    expect(weeklyRetention(film({ genres: ['Animation', 'Family'] })).factor).toBe(0.67);
    expect(weeklyRetention(film({ genres: ['Drama'] })).factor).toBe(0.6);
    expect(weeklyRetention(film({ genres: ['Comedy'] }), true).factor).toBe(0.42);
    expect(weeklyRetention(film({ genres: ['Comedy'], releaseDate: new Date('2026-06-12T00:00:00Z') })).factor).toBe(0.495);
  });

  it('keeps TMDB popularity out of forecasts unless an agreement is recorded', () => {
    const before = process.env.PULSE_TMDB_LICENSED;
    delete process.env.PULSE_TMDB_LICENSED;
    expect(tmdbPopularityLicensed()).toBe(false);
    process.env.PULSE_TMDB_LICENSED = 'true';
    expect(tmdbPopularityLicensed()).toBe(true);
    if (before === undefined) delete process.env.PULSE_TMDB_LICENSED;
    else process.env.PULSE_TMDB_LICENSED = before;
  });

  it('scales film strength by TMDB popularity rank', () => {
    const ranks = popularityRanks([film({ id: 'a', popularity: 10 }), film({ id: 'b', popularity: 50 }), film({ id: 'c', popularity: null })]);
    expect(ranks.get('a')).toBe(0);
    expect(ranks.get('b')).toBe(1);
    expect(ranks.has('c')).toBe(false);
    expect(filmStrength(undefined)).toBe(1);
    expect(filmStrength(1)).toBeCloseTo(1.2);
    expect(filmStrength(0)).toBeCloseTo(0.8);
  });

  it('builds the prior from slot, decay, format and school holiday, with reasons', () => {
    const p = prior({ ...show, filmWeek: 3, formats: ['IMAX'] }, { film: film() });
    expect(p.mu).toBeCloseTo(200 * SLOT_BASE['fri-sat-evening'] * 0.6 * 0.6 * 1.15, 5);
    expect(p.drivers.map((d) => d.label)).toEqual(['Week 3 of release', 'Premium format']);
    const holiday = prior({ ...show, slot: 'weekday-day', schoolHoliday: 'Summer' }, { film: film() });
    expect(holiday.drivers.some((d) => d.label === 'Summer' && d.effect === 1.3)).toBe(true);
  });
});

describe('Pulse learning and forecast', () => {
  const rows: OutcomeRow[] = [];
  for (let i = 0; i < 400; i++) {
    const venueId = i % 2 ? 'v1' : 'v2';
    const p = prior({ ...show, venueId }, { film: film() }).mu;
    rows.push({ ...show, venueId, admissions: Math.round(p * (venueId === 'v1' ? 1.5 : 0.8)), leadCurve: [0.05, 0.2, 0.3, 0.45, 0.6, 0.75, 0.85, 0.95, 1], source: 'demo', startsAt: new Date(2026, 0, 1 + (i % 100)) });
  }
  const model = fitModel(rows, new Map([['f1', { film: film() }]]));

  it('learns multipliers that recover the pattern, shrunk and clamped', () => {
    const ratio = model.multipliers.venue.v1.m / model.multipliers.venue.v2.m;
    expect(ratio).toBeGreaterThan(1.6);
    expect(ratio).toBeLessThan(2.1);
    expect(model.demoShows).toBe(400);
    const few = fitModel([{ ...rows[0], admissions: 500 }], new Map([['f1', { film: film() }]]));
    expect(few.multipliers.venue.v2.m).toBeLessThanOrEqual(2.5);
  });

  it('blends the learned booking curve with the prior and keeps it cumulative', () => {
    const c = model.curves['fri-sat-evening'];
    expect(c[c.length - 1]).toBe(1);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1]);
    expect(c[3]).toBeCloseTo(0.45, 1);
    expect(priorCurve('weekday-day')[8]).toBe(1);
    expect(curveAt(c, 0)).toBe(1);
    expect(curveAt(c, 36)).toBeGreaterThan(c[3] - 0.2);
  });

  it('trusts the model early and pace late, never above capacity or below seats sold', () => {
    const base = { ...show, screeningId: 's1', venueId: 'v1' };
    const early = forecast({ ...base, soldNow: 0, hoursBefore: 200 }, { film: film() }, model);
    const mu = expectedFromModel(base, { film: film() }, model);
    // A week out with nothing sold yet: almost all model, pulled down slightly by the empty pace.
    expect(early.expected).toBeGreaterThan(0.85 * mu);
    expect(early.expected).toBeLessThanOrEqual(Math.round(mu));
    const late = forecast({ ...base, soldNow: 150, hoursBefore: 1 }, { film: film() }, model);
    expect(late.expected).toBeGreaterThanOrEqual(150);
    expect(late.expected).toBeLessThanOrEqual(200);
    expect(late.low).toBeGreaterThanOrEqual(150);
    expect(late.paceIndex).toBeGreaterThan(1.3);
    expect(late.drivers.some((d) => d.label.startsWith('Selling ahead of pace'))).toBe(true);
    expect(late.confidence).toBe('high');
    expect(early.low).toBeLessThanOrEqual(early.expected);
    expect(early.high).toBeGreaterThanOrEqual(early.expected);
  });

  it('ignores sales with no sale time when judging pace', () => {
    const base = { ...show, screeningId: 's2', venueId: 'v1', hoursBefore: 30 };
    const mu = expectedFromModel(base, { film: film() }, model);
    // 120 seeded seats with no booking: no pace claim, forecast stays on the model with a floor at seats sold.
    const seeded = forecast({ ...base, soldNow: 120, timedSold: 0 }, { film: film() }, model);
    expect(seeded.paceIndex).toBeNull();
    expect(seeded.drivers.some((d) => d.label.startsWith('Selling'))).toBe(false);
    expect(seeded.expected).toBeGreaterThan(120);
    expect(seeded.expected).toBeGreaterThanOrEqual(Math.round(Math.min(200, mu)));
    expect(seeded.paceBasis).toBe('untimed');
    expect(seeded.confidence).not.toBe('high');
    // Mostly real bookings: pace counts only the timed ones.
    const mixed = forecast({ ...base, soldNow: 40, timedSold: 30 }, { film: film() }, model);
    const real = forecast({ ...base, soldNow: 30, timedSold: 30 }, { film: film() }, model);
    expect(mixed.paceIndex).toBe(real.paceIndex);
    expect(mixed.expected).toBeGreaterThanOrEqual(40);
  });
});
