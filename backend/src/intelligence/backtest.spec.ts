import { backtest, calibrateRanges } from './backtest';
import { FilmContext, fitModel, LEAD_BUCKETS, OutcomeRow, priorCurve, releaseFactor, SLOT_BASE } from './pulse';
import { rng } from './outcomes';

const DAY = 86400_000;

/** Synthetic history with a known truth: two cinemas, one 30% busier, Poisson-ish noise. */
function history(weeks = 16, seed = 7): { rows: OutcomeRow[]; films: Map<string, FilmContext> } {
  const r = rng(seed);
  const start = Date.UTC(2026, 3, 6);
  const films = new Map<string, FilmContext>();
  for (let i = 0; i < 8; i++) films.set(`f${i}`, { film: { id: `f${i}`, title: `F${i}`, genres: ['Drama'], certificate: '12A', releaseDate: new Date(start + i * 14 * DAY) } });
  const rows: OutcomeRow[] = [];
  for (let d = 0; d < weeks * 7; d++) {
    for (const venueId of ['busy', 'quiet']) {
      for (const slot of ['weekday-evening', 'fri-sat-evening'] as const) {
        const startsAt = new Date(start + d * DAY + 19 * 3600_000);
        const live = [...films.values()].filter((f) => f.film.releaseDate.getTime() <= startsAt.getTime()).slice(-3);
        if (!live.length) continue;
        const f = live[Math.floor(r() * live.length)];
        const filmWeek = Math.floor((startsAt.getTime() - f.film.releaseDate.getTime()) / (7 * DAY)) + 1;
        const mu = 150 * SLOT_BASE[slot] * releaseFactor(0.6, filmWeek) * (venueId === 'busy' ? 1.3 : 0.9);
        const admissions = Math.max(0, Math.min(150, Math.round(mu * (0.75 + r() * 0.5))));
        rows.push({ venueId, filmId: f.film.id, capacity: 150, slot, dayOfWeek: startsAt.getUTCDay(), filmWeek, formats: [], schoolHoliday: null, admissions, leadCurve: priorCurve(slot), source: 'demo', startsAt });
      }
    }
  }
  return { rows, films };
}

describe('Backtest', () => {
  it('scores Pulse on weeks it has not seen, and beats the UK prior once it has learned the cinemas', () => {
    const { rows, films } = history();
    const b = backtest(rows, films, { folds: 4 });
    expect(b.folds).toBe(4);
    expect(b.weekly).toHaveLength(4);
    const weekOut = b.pulse.find((p) => p.hoursBefore === 168)!.score;
    const dayOut = b.pulse.find((p) => p.hoursBefore === 24)!.score;
    expect(weekOut.shows).toBeGreaterThan(50);
    expect(weekOut.wape).toBeLessThan(b.baselines.ukPrior.wape);
    // Live sales help: a day out is at least as good as a week out.
    expect(dayOut.wape).toBeLessThanOrEqual(weekOut.wape + 0.01);
    expect(weekOut.coverage80).not.toBeNull();
  });

  it('calibrates ranges from recent errors so roughly 80% of shows fall inside', () => {
    const { rows, films } = history();
    const model = fitModel(rows, films);
    const scales = calibrateRanges(rows, films, model);
    expect(scales).toHaveLength(LEAD_BUCKETS.length);
    expect(scales.every((s) => s >= 0.1 && s <= 3)).toBe(true);
    const b = backtest(rows, films, { folds: 4 });
    const cov = b.pulse.find((p) => p.hoursBefore === 168)!.score.coverage80!;
    expect(cov).toBeGreaterThan(0.6);
    expect(cov).toBeLessThan(0.97);
  });

  it('returns an empty result rather than guessing with too little history', () => {
    const { rows, films } = history(2);
    const b = backtest(rows.slice(0, 100), films);
    expect(b.folds).toBe(0);
    expect(b.pulse.every((p) => p.score.shows === 0)).toBe(true);
  });
});
