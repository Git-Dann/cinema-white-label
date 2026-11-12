import { Slot } from './calendar';
import { FilmFacts, PROGRAMME_DECAY_MEAN, SLOT_BASE, weeklyRetention } from './pulse';

/*
 * Film runs: after a film opens, how quickly is its audience falling away here, and what does
 * that mean for next week's programme?
 *
 * Each film week gets a "pull": admissions against what a typical film would sell in the same
 * shows (capacity × slot base), so programming more or fewer shows does not distort it. The
 * weekly retention r is fitted by weighted least squares on log pull with a Bayesian (ridge)
 * prior pulling log r towards the genre's retention:
 *
 *   minimise  Σ_w n_w (log p_w − a − (w−1)·log r)² / s²  +  (log r − log r₀)² / τ²
 *
 * where n_w is the number of shows in week w (more shows, more trust), s = 0.35 the typical
 * spread of weekly pull, and τ = 0.25 how far a film may stray from its genre prior. With one
 * week of data the prior decides the decay; after three or four, the film's own run does.
 *
 * The prior is the genre retention from pulse.ts, adjusted by the opening surprise: films that
 * open above expectations hold up better and those below fall faster (Moretti 2011: weekly
 * retention about 0.53 after a positive surprise against 0.29 after a negative one, US data).
 */

export const PULL_SPREAD = 0.35;
export const PRIOR_SPREAD = 0.25;

export interface WeekRow {
  filmWeek: number;
  shows: number;
  admissions: number;
  /** Σ capacity × slot base over the week's shows: what a typical film would sell. */
  norm: number;
}

export interface FilmRun {
  filmId: string;
  title: string;
  weeks: { filmWeek: number; shows: number; admissions: number; pull: number }[];
  /** Pull in the opening week, against the average film on a typical programme (a normal opening is about 1.9). */
  openingPull: number | null;
  /** Opening week against a usual opening: 1 is typical, above 1 a stronger start. */
  openingVsUsual: number | null;
  priorRetention: number;
  retention: number;
  /** How much the film's own weeks moved the estimate away from the prior (0 none, 1 all). */
  dataWeight: number;
  nextWeek: number;
  projectedPull: number;
  verdict: 'grow' | 'hold' | 'trim' | 'end';
  reason: string;
}

/** Folds outcome rows into weekly rows for one film. */
export function weeklyRows(rows: { filmWeek: number; admissions: number; capacity: number; slot: string }[]): WeekRow[] {
  const by = new Map<number, WeekRow>();
  for (const r of rows) {
    const w = by.get(r.filmWeek) ?? { filmWeek: r.filmWeek, shows: 0, admissions: 0, norm: 0 };
    w.shows++;
    w.admissions += r.admissions;
    w.norm += r.capacity * (SLOT_BASE[r.slot as Slot] ?? 0.2);
    by.set(r.filmWeek, w);
  }
  return [...by.values()].sort((a, b) => a.filmWeek - b.filmWeek);
}

/**
 * Prior retention: genre retention, nudged by the opening surprise. Pull is measured against the
 * average film on a typical programme, where a normal opening week sits at 1 / PROGRAMME_DECAY_MEAN
 * (about 1.9), so the surprise is openingPull × PROGRAMME_DECAY_MEAN.
 */
export function priorRetention(film: Pick<FilmFacts, 'genres' | 'releaseDate' | 'series'>, openingPull: number | null): number {
  const base = weeklyRetention(film).factor;
  if (openingPull === null) return base;
  const surprise = openingPull * PROGRAMME_DECAY_MEAN;
  // Above expectations holds better; below fades faster. Bounded.
  const nudge = surprise >= 1.3 ? 1.1 : surprise <= 0.75 ? 0.85 : 1;
  return Math.min(0.85, Math.max(0.25, Math.round(base * nudge * 1000) / 1000));
}

/** Weighted least squares for (a, b = log r) with a ridge prior on b. Closed form 2×2. */
export function fitRetention(weeks: WeekRow[], prior: number): { retention: number; dataWeight: number; level: number } {
  const pts = weeks.filter((w) => w.norm > 0 && w.shows > 0).map((w) => ({ x: w.filmWeek - 1, y: Math.log(Math.max(w.admissions, 0.5) / w.norm), wt: w.shows / (PULL_SPREAD * PULL_SPREAD) }));
  const b0 = Math.log(prior);
  const lam = 1 / (PRIOR_SPREAD * PRIOR_SPREAD);
  if (!pts.length) return { retention: prior, dataWeight: 0, level: 0 };
  const S = pts.reduce((a, p) => a + p.wt, 0);
  const Sx = pts.reduce((a, p) => a + p.wt * p.x, 0);
  const Sxx = pts.reduce((a, p) => a + p.wt * p.x * p.x, 0);
  const Sy = pts.reduce((a, p) => a + p.wt * p.y, 0);
  const Sxy = pts.reduce((a, p) => a + p.wt * p.x * p.y, 0);
  // Normal equations: [S Sx; Sx Sxx+lam] [a; b] = [Sy; Sxy + lam·b0]
  const det = S * (Sxx + lam) - Sx * Sx;
  const a = ((Sxx + lam) * Sy - Sx * (Sxy + lam * b0)) / det;
  const b = (S * (Sxy + lam * b0) - Sx * Sy) / det;
  // Share of the information about b that came from the data rather than the prior.
  const dataInfo = Sxx - (Sx * Sx) / S;
  const dataWeight = dataInfo / (dataInfo + lam);
  const retention = Math.min(0.95, Math.max(0.1, Math.exp(b)));
  return { retention: Math.round(retention * 1000) / 1000, dataWeight: Math.round(dataWeight * 100) / 100, level: a };
}

/** The run so far and what to do next week. A film with pull ≥ 1.2 next week deserves more shows; ≤ 0.6, fewer. */
export function filmRun(film: FilmFacts, weeks: WeekRow[], nowWeek: number): FilmRun {
  const opening = weeks.find((w) => w.filmWeek === 1);
  const openingPull = opening && opening.norm > 0 ? opening.admissions / opening.norm : null;
  const prior = priorRetention(film, openingPull);
  const fit = fitRetention(weeks, prior);
  const nextWeek = Math.max(nowWeek + 1, (weeks[weeks.length - 1]?.filmWeek ?? 0) + 1);
  const projectedPull = Math.round(Math.exp(fit.level) * Math.pow(fit.retention, nextWeek - 1) * 100) / 100;
  const pct = (x: number) => (x > 0 && x < 0.01 ? 'under 1%' : `${Math.round(x * 100)}%`);
  const verdict: FilmRun['verdict'] = projectedPull >= 1.2 ? 'grow' : projectedPull < 0.25 ? 'end' : projectedPull <= 0.6 ? 'trim' : 'hold';
  const kept = `keeps about ${pct(fit.retention)} of its audience each week${fit.dataWeight >= 0.5 ? ' here' : ', mostly from its genre so far'}`;
  const reason =
    verdict === 'grow'
      ? `Still selling ${projectedPull.toFixed(1)} times a typical film in week ${nextWeek}: it ${kept}. Worth more shows or a bigger screen.`
      : verdict === 'hold'
        ? `About in line with a typical film in week ${nextWeek} (${projectedPull.toFixed(1)} times): it ${kept}.`
        : verdict === 'trim'
          ? `Down to ${projectedPull.toFixed(1)} times a typical film in week ${nextWeek}: it ${kept}. Fewer shows, or move it to a smaller screen.`
          : `Expected at ${pct(projectedPull)} of a typical film in week ${nextWeek}: it ${kept}. Consider ending its run.`;
  return {
    filmId: film.id,
    title: film.title,
    weeks: weeks.map((w) => ({ filmWeek: w.filmWeek, shows: w.shows, admissions: w.admissions, pull: Math.round((w.admissions / Math.max(w.norm, 1e-9)) * 100) / 100 })),
    openingPull: openingPull === null ? null : Math.round(openingPull * 100) / 100,
    openingVsUsual: openingPull === null ? null : Math.round(openingPull * PROGRAMME_DECAY_MEAN * 100) / 100,
    priorRetention: prior,
    retention: fit.retention,
    dataWeight: fit.dataWeight,
    nextWeek,
    projectedPull,
    verdict,
    reason,
  };
}
