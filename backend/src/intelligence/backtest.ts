import { curveAt, FilmContext, fitModel, forecast, LEAD_BUCKETS, OutcomeRow, prior, PulseModel, SLOT_BASE } from './pulse';

/*
 * Rolling-origin backtest: how accurate Pulse would have been, scored on history it had not
 * seen. For each of the last N weeks, fit on everything before the week, forecast every show
 * in it at several points before the start (using that show's real booking curve to know how
 * many seats had sold by then), and compare with what sold. Two baselines keep it honest:
 * the UK prior on its own, and a seasonal naive (the average of the same cinema, time of day
 * and weekday over the previous four weeks), which is what a manager's gut usually does.
 */

const DAY = 86400_000;

export interface Score {
  shows: number;
  /** Weighted absolute percentage error: sum |forecast - actual| / sum actual. Lower is better. */
  wape: number;
  /** Signed error as a share of actual: positive means over-forecasting. */
  bias: number;
  /** Share of shows whose admissions fell inside the 80% range. Should be close to 0.8. */
  coverage80: number | null;
}

export interface BacktestResult {
  folds: number;
  from: string | null;
  to: string | null;
  /** Pulse at each lead time before the start. */
  pulse: { hoursBefore: number; score: Score }[];
  baselines: { ukPrior: Score; seasonalNaive: Score };
  /** Week-by-week Pulse error a week out, oldest first. */
  weekly: { weekStart: string; wape: number; shows: number }[];
}

class Acc {
  n = 0;
  abs = 0;
  signed = 0;
  actual = 0;
  inside = 0;
  ranged = 0;
  add(pred: number, act: number, low?: number, high?: number) {
    this.n++;
    this.abs += Math.abs(pred - act);
    this.signed += pred - act;
    this.actual += act;
    if (low !== undefined && high !== undefined) {
      this.ranged++;
      if (act >= low && act <= high) this.inside++;
    }
  }
  score(): Score {
    const r = (x: number) => Math.round(x * 1000) / 1000;
    return {
      shows: this.n,
      wape: this.actual ? r(this.abs / this.actual) : 0,
      bias: this.actual ? r(this.signed / this.actual) : 0,
      coverage80: this.ranged ? r(this.inside / this.ranged) : null,
    };
  }
}

// Same cinema, same-sized screen (a stand-in for the screen itself), time of day and weekday.
const seasonalKey = (r: OutcomeRow) => `${r.venueId}|${r.capacity}|${r.slot}|${r.dayOfWeek}`;
const Z80 = 1.2816;
const filmCtx = (films: Map<string, FilmContext>, r: OutcomeRow): FilmContext => films.get(r.filmId) ?? { film: { id: r.filmId, title: 'Film', genres: [], certificate: 'TBC', releaseDate: r.startsAt } };

function quantile(xs: number[], q: number): number {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  const i = Math.min(a.length - 1, Math.max(0, Math.round(q * (a.length - 1))));
  return a[i];
}

/**
 * Split-conformal style range calibration: forecast the most recent weeks with the fitted
 * model, measure how far actuals fell from the forecast in units of the model's spread, and
 * scale the spread per lead bucket so 80% of those shows would have landed inside. Bounded so
 * one odd week cannot collapse or explode the ranges.
 */
export function calibrateRanges(rows: OutcomeRow[], films: Map<string, FilmContext>, model: PulseModel, weeks = 3): number[] {
  if (!rows.length) return LEAD_BUCKETS.map(() => 1);
  const last = Math.max(...rows.map((r) => r.startsAt.getTime()));
  const recent = rows.filter((r) => r.startsAt.getTime() > last - weeks * 7 * DAY);
  const base = { ...model, rangeScale: undefined };
  return LEAD_BUCKETS.map((h) => {
    const z: number[] = [];
    for (const r of recent) {
      const share = r.leadCurve ? curveAt(r.leadCurve, h) : h >= 168 ? 0 : null;
      if (share === null) continue;
      const soldNow = Math.min(r.admissions, Math.round(r.admissions * share));
      if (soldNow >= r.admissions && h > 0) continue; // nothing left to forecast
      const f = forecast({ ...r, screeningId: '', soldNow, timedSold: soldNow, hoursBefore: h }, filmCtx(films, r), base);
      if (f.sd > 0) z.push(Math.abs(r.admissions - f.expected) / f.sd);
    }
    if (z.length < 50) return 1;
    return Math.round(Math.min(3, Math.max(0.1, quantile(z, 0.8) / Z80)) * 1000) / 1000;
  });
}

export function backtest(rows: OutcomeRow[], films: Map<string, FilmContext>, opts: { folds?: number; horizons?: number[] } = {}): BacktestResult {
  const folds = opts.folds ?? 8;
  const horizons = opts.horizons ?? [168, 24, 3];
  const empty: BacktestResult = { folds: 0, from: null, to: null, pulse: horizons.map((h) => ({ hoursBefore: h, score: new Acc().score() })), baselines: { ukPrior: new Acc().score(), seasonalNaive: new Acc().score() }, weekly: [] };
  if (rows.length < 200) return empty;
  const sorted = [...rows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const end = sorted[sorted.length - 1].startsAt.getTime() + 1;
  const pulse = horizons.map(() => new Acc());
  const ukPrior = new Acc();
  const naive = new Acc();
  const weekly: BacktestResult['weekly'] = [];
  let done = 0;
  for (let k = folds; k >= 1; k--) {
    const cut = end - k * 7 * DAY;
    const train = sorted.filter((r) => r.startsAt.getTime() < cut && r.startsAt.getTime() >= cut - 365 * DAY);
    const test = sorted.filter((r) => r.startsAt.getTime() >= cut && r.startsAt.getTime() < cut + 7 * DAY);
    if (train.length < 200 || !test.length) continue;
    done++;
    const fitted = fitModel(train, films);
    // Calibrate ranges on the training data only, as production does.
    const model: PulseModel = { ...fitted, rangeScale: calibrateRanges(train, films, fitted) };
    // Seasonal naive from the four weeks before the cut.
    const recent = new Map<string, { sum: number; n: number }>();
    for (const r of train) {
      if (r.startsAt.getTime() < cut - 28 * DAY) continue;
      const s = recent.get(seasonalKey(r)) ?? { sum: 0, n: 0 };
      s.sum += r.admissions;
      s.n++;
      recent.set(seasonalKey(r), s);
    }
    const week = new Acc();
    for (const r of test) {
      const ctx = filmCtx(films, r);
      horizons.forEach((h, i) => {
        // Seats sold by then, from the show's own booking curve. Without one, only the week-out forecast is fair.
        const share = r.leadCurve ? curveAt(r.leadCurve, h) : h >= 168 ? 0 : null;
        if (share === null) return;
        const soldNow = Math.min(r.admissions, Math.round(r.admissions * share));
        const f = forecast({ ...r, screeningId: '', soldNow, timedSold: soldNow, hoursBefore: h }, ctx, model);
        pulse[i].add(f.expected, r.admissions, f.low, f.high);
        if (i === 0) week.add(f.expected, r.admissions);
      });
      ukPrior.add(Math.min(r.capacity, prior(r, ctx).mu), r.admissions);
      const s = recent.get(seasonalKey(r));
      naive.add(s ? s.sum / s.n : r.capacity * SLOT_BASE[r.slot], r.admissions);
    }
    weekly.push({ weekStart: new Date(cut).toISOString().slice(0, 10), wape: week.score().wape, shows: week.n });
  }
  if (!done) return empty;
  return {
    folds: done,
    from: weekly[0]?.weekStart ?? null,
    to: new Date(end).toISOString().slice(0, 10),
    pulse: horizons.map((h, i) => ({ hoursBefore: h, score: pulse[i].score() })),
    baselines: { ukPrior: ukPrior.score(), seasonalNaive: naive.score() },
    weekly,
  };
}
