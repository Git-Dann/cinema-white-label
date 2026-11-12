import { DAY_NAMES, isDaySlot, Slot, SLOT_LABELS, SLOTS, slotOf } from './calendar';
import type { ConversationView } from './conversation';

/**
 * Seatfold Pulse: the demand model. Deterministic, explainable, no dependencies.
 *
 *   prior     μ0 = capacity × slot base × release decay × film strength × format × school holiday
 *   learned   μ  = μ0 × Π m(dimension)            (shrunk ratios, iterative proportional fitting)
 *   pace      P  = sold now ÷ F(hours to go)       (booking curve for the slot)
 *   blend     E  = w·P + (1−w)·μ, w = F^0.7        (more sold-through, more trust in pace)
 *
 * See docs/pulse.md for the reasoning and sources behind every constant.
 */

// ---------------------------------------------------------------------------
// Priors (calibrated to published UK figures; see docs/pulse.md)
// ---------------------------------------------------------------------------

/** Shape of occupancy by slot before scaling (Fri/Sat evening highest, weekday daytime lowest). */
const SLOT_SHAPE: Record<Slot, number> = { 'weekday-day': 0.12, 'weekday-evening': 0.3, 'fri-sat-evening': 0.55, 'weekend-day': 0.4, late: 0.18 };
/** Capacity-weighted weekly average occupancy we calibrate to (UK multiplex ~15-20%; ICO plans on 20%). */
export const TARGET_WEEKLY_OCCUPANCY = 0.19;
/** A typical week: four shows a day at these times on every screen. */
export const TYPICAL_TIMES = ['12:30', '15:20', '18:10', '20:50'];

export function typicalWeekSlots(): Slot[] {
  const out: Slot[] = [];
  for (let dow = 0; dow < 7; dow++) for (const t of TYPICAL_TIMES) out.push(slotOf(dow, Number(t.slice(0, 2)) * 60 + Number(t.slice(3))));
  return out;
}

/**
 * The slot bases are averages over a whole programme, which mixes new and older films. Release
 * decay is therefore measured against the decay of a typical programme, not against opening
 * week: a typical retention of 0.55 a week, with screenings weighted towards newer films the
 * way operators programme them (weeks 1 to 6: 1, 0.8, 0.6, 0.45, 0.3, 0.2). Opening week then
 * sits about 1.9 times above the average and week four about at it.
 */
export const PROGRAMME_SHOW_WEIGHTS = [1, 0.8, 0.6, 0.45, 0.3, 0.2];
export const TYPICAL_RETENTION = 0.55;
export const PROGRAMME_DECAY_MEAN = (() => {
  const w = PROGRAMME_SHOW_WEIGHTS;
  const num = w.reduce((a, x, i) => a + x * Math.pow(TYPICAL_RETENTION, i), 0);
  return Math.round((num / w.reduce((a, x) => a + x, 0)) * 1000) / 1000;
})();

/** Release factor against a typical programme: retention^(week − 1) ÷ PROGRAMME_DECAY_MEAN. */
export const releaseFactor = (retention: number, filmWeek: number) => Math.round((Math.pow(retention, Math.max(0, filmWeek - 1)) / PROGRAMME_DECAY_MEAN) * 1000) / 1000;

/** Base occupancy per slot, scaled so a typical week averages TARGET_WEEKLY_OCCUPANCY. */
export const SLOT_BASE: Record<Slot, number> = (() => {
  const week = typicalWeekSlots();
  const avg = week.reduce((a, s) => a + SLOT_SHAPE[s], 0) / week.length;
  const k = TARGET_WEEKLY_OCCUPANCY / avg;
  return Object.fromEntries(SLOTS.map((s) => [s, Math.round(SLOT_SHAPE[s] * k * 1000) / 1000])) as Record<Slot, number>;
})();

export interface FilmFacts {
  id: string;
  title: string;
  genres: string[];
  certificate: string;
  releaseDate: Date;
  /** TMDB popularity, when imported. Only used when licensed (tmdbPopularityLicensed). */
  popularity?: number | null;
  /** Part of a series or a sequel (Wikidata). Front-loaded like franchise releases. */
  series?: boolean;
}

const lower = (g: string[]) => g.map((x) => x.toLowerCase());
const BLOCKBUSTER = ['action', 'adventure', 'science fiction', 'sci-fi', 'fantasy', 'superhero'];
const STEADY = ['family', 'animation', 'drama', 'documentary', 'history', 'music'];

/**
 * Week-on-week attendance factor. Normal films keep ~60% a week (second-weekend drop ~40%);
 * blockbusters, horror and top-decile openings keep ~42%; family, animation and drama keep ~70%.
 * Summer (May to July) releases drop a further 10% a week.
 */
export function weeklyRetention(film: Pick<FilmFacts, 'genres' | 'releaseDate' | 'series'>, topDecile = false): { factor: number; kind: string } {
  const g = lower(film.genres);
  // UK legs (final gross / opening weekend, 2023 top films): median 3.67 overall, 5.2 family,
  // 2.95 franchise action, 4.3 adult drama. With the weekend about 58% of a week's sales,
  // legs L imply week-on-week retention r = 1 - 1 / (0.58 L). See docs/pulse-data-sources.md.
  let factor = 0.55;
  let kind = 'a typical film';
  if (g.includes('family') || g.includes('animation')) [factor, kind] = [0.67, 'a family film'];
  else if (g.includes('horror')) [factor, kind] = [0.42, 'a horror film'];
  else if (g.some((x) => BLOCKBUSTER.includes(x))) [factor, kind] = [0.42, 'a big action release'];
  else if (g.some((x) => STEADY.includes(x))) [factor, kind] = [0.6, 'a drama'];
  if (film.series && factor > 0.42 && kind !== 'a family film') [factor, kind] = [0.42, 'a sequel or series film'];
  if (topDecile && factor > 0.42) [factor, kind] = [0.42, 'a big opening'];
  const month = film.releaseDate.getUTCMonth() + 1;
  if (month >= 5 && month <= 7) factor = factor * 0.9;
  return { factor: Math.round(factor * 1000) / 1000, kind };
}

/**
 * TMDB's free licence forbids commercial use and use in machine-learning applications, so its
 * popularity only feeds Pulse when an operator has a written TMDB agreement that covers it.
 */
export const tmdbPopularityLicensed = () => process.env.PULSE_TMDB_LICENSED === 'true';

/** Percentile rank (0 to 1) of each film's TMDB popularity among the operator's films that have one. */
export function popularityRanks(films: FilmFacts[]): Map<string, number> {
  const withPop = films.filter((f) => typeof f.popularity === 'number').sort((a, b) => a.popularity! - b.popularity!);
  const out = new Map<string, number>();
  withPop.forEach((f, i) => out.set(f.id, withPop.length > 1 ? i / (withPop.length - 1) : 0.5));
  return out;
}

/** Film strength from TMDB popularity rank: 0.8 + 0.4 × rank, kept within 0.6 to 1.8. Unknown is neutral. */
export function filmStrength(rank: number | undefined): number {
  if (rank === undefined) return 1;
  return Math.min(1.8, Math.max(0.6, 0.8 + 0.4 * rank));
}

export function formatUplift(formats: string[]): number {
  const f = formats.map((x) => x.toUpperCase());
  if (f.some((x) => x.includes('IMAX') || x.includes('4DX'))) return 1.15;
  if (f.some((x) => x.includes('3D'))) return 1.05;
  return 1;
}

export const filmWeekOf = (releaseDate: Date, startsAt: Date) => Math.max(1, Math.floor((startsAt.getTime() - releaseDate.getTime()) / (7 * 86400_000)) + 1);
export const filmWeekBand = (w: number) => (w <= 1 ? '1' : w === 2 ? '2' : w === 3 ? '3' : w <= 5 ? '4-5' : '6+');

export interface ShowFeatures {
  venueId: string;
  filmId: string;
  capacity: number;
  slot: Slot;
  dayOfWeek: number;
  filmWeek: number;
  formats: string[];
  /** Name of the school holiday, if any. */
  schoolHoliday: string | null;
}

export interface Driver {
  label: string;
  /** Multiplier on expected admissions. */
  effect: number;
  explanation: string;
}

export interface FilmContext {
  film: FilmFacts;
  /** TMDB popularity percentile; only set when licensed. */
  rank?: number;
  /** Audience interest from Wikipedia page views (see interest.ts). */
  interest?: { views: number; typical: number; strength: number; source: 'wikipedia' | 'demo' };
  /** Social conversation on Bluesky this week (see conversation.ts); capped at ±8%. */
  conversation?: ConversationView;
}

/** The prior expectation for a show, with the reasons. */
export function prior(show: ShowFeatures, ctx: FilmContext): { base: number; mu: number; drivers: Driver[] } {
  const base = SLOT_BASE[show.slot];
  // Audience interest lifts the opening only. It does not steepen decay: films that open above
  // expectations hold up better, not worse (Moretti 2011), so only licensed popularity rank applies here.
  const topDecile = (ctx.rank ?? 0) >= 0.9;
  const ret = weeklyRetention(ctx.film, topDecile);
  const decay = releaseFactor(ret.factor, show.filmWeek);
  const strength = ctx.interest ? ctx.interest.strength : filmStrength(ctx.rank);
  const talk = ctx.conversation?.strength ?? 1;
  const fmt = formatUplift(show.formats);
  const holiday = show.schoolHoliday && isDaySlot(show.slot) ? 1.3 : 1;
  const drivers: Driver[] = [];
  if (show.filmWeek > 1) drivers.push({ label: `Week ${show.filmWeek} of release`, effect: decay, explanation: `As ${ret.kind}, it usually keeps about ${Math.round(ret.factor * 100)}% of its audience each week; ${decay >= 1 ? 'still above' : 'now below'} the average film on a typical programme.` });
  else drivers.push({ label: 'Opening week', effect: decay, explanation: `Films sell best in their first week: about ${decay.toFixed(1)} times the average film on a typical programme.` });
  if (ctx.interest && strength !== 1) {
    const x = ctx.interest.views / ctx.interest.typical;
    const rel = x >= 1 ? `${x.toFixed(1)} times` : `${Math.round(x * 100)}% of`;
    drivers.push({
      label: strength > 1 ? 'Strong audience interest' : 'Quieter audience interest',
      effect: strength,
      explanation: `Its Wikipedia page views over the month that counts are ${rel} the typical film you are showing${ctx.interest.source === 'demo' ? ' (demo figures)' : ' (Wikimedia, CC0)'}.`,
    });
  } else if (strength !== 1) drivers.push({ label: strength > 1 ? 'Popular film' : 'Quieter film', effect: strength, explanation: `Ranks in the ${Math.round((ctx.rank ?? 0) * 100)}th percentile of popularity among your films (licensed TMDB data).` });
  if (ctx.conversation && talk !== 1) {
    const c = ctx.conversation;
    const x = c.typical > 0 ? c.posts7 / c.typical : 0;
    const rel = x >= 1 ? `${x.toFixed(1)} times` : `${Math.round(x * 100)}% of`;
    const trend = c.momentum >= 1.25 ? ` and climbing (${c.momentum.toFixed(1)} times last week)` : c.momentum <= 0.8 ? ' and easing off' : '';
    drivers.push({
      label: talk > 1 ? 'People are talking' : 'Little social talk',
      effect: talk,
      explanation: `${c.posts7} posts about it on Bluesky in the last 7 days, ${rel} the typical film you are showing${trend}${c.source === 'demo' ? ' (demo figures)' : ''}. Kept to a small effect until your own sales confirm it.`,
    });
  }
  if (fmt !== 1) drivers.push({ label: 'Premium format', effect: fmt, explanation: 'IMAX, 4DX and 3D shows usually sell a little better.' });
  if (holiday !== 1) drivers.push({ label: show.schoolHoliday!, effect: holiday, explanation: 'Daytime shows sell more in school holidays (approximate England and Wales dates).' });
  return { base, mu: show.capacity * base * decay * strength * talk * fmt * holiday, drivers };
}

// ---------------------------------------------------------------------------
// Learning from outcomes
// ---------------------------------------------------------------------------

export const DIMENSIONS = ['venue', 'slot', 'dayOfWeek', 'filmWeekBand', 'film'] as const;
export type Dimension = (typeof DIMENSIONS)[number];
/** Pseudo-admissions of prior belief per multiplier: small samples stay near 1. */
export const SHRINKAGE_K = 150;
export const LEAD_BUCKETS = [168, 72, 48, 24, 12, 6, 3, 1, 0];

export interface OutcomeRow extends ShowFeatures {
  admissions: number;
  leadCurve: number[] | null;
  source: 'live' | 'demo';
  startsAt: Date;
}

export interface PulseModel {
  multipliers: Record<Dimension, Record<string, { m: number; shows: number }>>;
  curves: Record<Slot, number[]>;
  /**
   * Range calibration per lead bucket (LEAD_BUCKETS): multiplies the spread so that about 80% of
   * shows land inside the 80% range. Fitted from recent errors (backtest.ts, calibrateRanges).
   */
  rangeScale?: number[];
  curveShows: Record<Slot, number>;
  shows: number;
  liveShows: number;
  demoShows: number;
  from: string | null;
  to: string | null;
}

export function keyOf(dim: Dimension, s: ShowFeatures): string {
  switch (dim) {
    case 'venue':
      return s.venueId;
    case 'slot':
      return s.slot;
    case 'dayOfWeek':
      return String(s.dayOfWeek);
    case 'filmWeekBand':
      return filmWeekBand(s.filmWeek);
    case 'film':
      return s.filmId;
  }
}

/** Prior booking curve: a logistic share sold by h hours before the start, 1 at the start. */
export function priorCurve(slot: Slot): number[] {
  const h50 = isDaySlot(slot) ? 20 : slot === 'late' ? 24 : 30;
  const s = 18;
  const raw = (h: number) => 1 / (1 + Math.exp((h - h50) / s));
  return LEAD_BUCKETS.map((h) => Math.round((raw(h) / raw(0)) * 1000) / 1000);
}

const median = (xs: number[]) => {
  if (!xs.length) return NaN;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};

/**
 * Fits the learned multipliers by iterative proportional fitting with empirical-Bayes
 * shrinkage, and the booking curves by bucket medians blended with the prior curve.
 */
export function fitModel(rows: OutcomeRow[], films: Map<string, FilmContext>, iterations = 4): PulseModel {
  const multipliers = Object.fromEntries(DIMENSIONS.map((d) => [d, {} as Record<string, { m: number; shows: number }>])) as PulseModel['multipliers'];
  const priors = rows.map((r) => {
    const ctx = films.get(r.filmId);
    return ctx ? prior(r, ctx).mu : r.capacity * SLOT_BASE[r.slot];
  });
  for (const d of DIMENSIONS) for (const r of rows) {
    const k = keyOf(d, r);
    const cell = (multipliers[d][k] ??= { m: 1, shows: 0 });
    cell.shows++;
  }
  const mult = (r: OutcomeRow, skip?: Dimension) => DIMENSIONS.reduce((a, d) => (d === skip ? a : a * multipliers[d][keyOf(d, r)].m), 1);
  for (let it = 0; it < iterations; it++) {
    for (const d of DIMENSIONS) {
      const obs: Record<string, number> = {};
      const exp: Record<string, number> = {};
      rows.forEach((r, i) => {
        const k = keyOf(d, r);
        obs[k] = (obs[k] ?? 0) + r.admissions;
        exp[k] = (exp[k] ?? 0) + priors[i] * mult(r, d);
      });
      for (const k of Object.keys(obs)) multipliers[d][k].m = Math.min(2.5, Math.max(0.4, (obs[k] + SHRINKAGE_K) / (exp[k] + SHRINKAGE_K)));
    }
  }
  for (const d of DIMENSIONS) for (const c of Object.values(multipliers[d])) c.m = Math.round(c.m * 1000) / 1000;

  const curves = {} as Record<Slot, number[]>;
  const curveShows = {} as Record<Slot, number>;
  for (const slot of SLOTS) {
    const withCurve = rows.filter((r) => r.slot === slot && Array.isArray(r.leadCurve) && r.leadCurve.length === LEAD_BUCKETS.length);
    const p = priorCurve(slot);
    const n = withCurve.length;
    curveShows[slot] = n;
    const w = n / (n + 20);
    curves[slot] = LEAD_BUCKETS.map((_, i) => {
      const learned = n ? median(withCurve.map((r) => r.leadCurve![i])) : p[i];
      return Math.round((w * learned + (1 - w) * p[i]) * 1000) / 1000;
    });
    // Keep it a cumulative curve that reaches 1 at the start.
    for (let i = 1; i < curves[slot].length; i++) curves[slot][i] = Math.max(curves[slot][i], curves[slot][i - 1]);
    curves[slot][curves[slot].length - 1] = 1;
  }
  const times = rows.map((r) => r.startsAt.getTime());
  return {
    multipliers,
    curves,
    curveShows,
    shows: rows.length,
    liveShows: rows.filter((r) => r.source === 'live').length,
    demoShows: rows.filter((r) => r.source === 'demo').length,
    from: times.length ? new Date(Math.min(...times)).toISOString() : null,
    to: times.length ? new Date(Math.max(...times)).toISOString() : null,
  };
}

/** Calibration factor for the lead bucket nearest to `hoursBefore` (1 when not calibrated). */
export function rangeScaleAt(model: Pick<PulseModel, 'rangeScale'>, hoursBefore: number): number {
  if (!model.rangeScale) return 1;
  let best = 0;
  LEAD_BUCKETS.forEach((h, i) => {
    if (Math.abs(h - hoursBefore) < Math.abs(LEAD_BUCKETS[best] - hoursBefore)) best = i;
  });
  return model.rangeScale[best] ?? 1;
}

/** Share of final sales expected to be sold `hoursBefore` the start (linear between buckets). */
export function curveAt(curve: number[], hoursBefore: number): number {
  if (hoursBefore <= 0) return 1;
  if (hoursBefore >= LEAD_BUCKETS[0]) return curve[0] * (LEAD_BUCKETS[0] / hoursBefore);
  for (let i = 0; i < LEAD_BUCKETS.length - 1; i++) {
    const [h1, h2] = [LEAD_BUCKETS[i], LEAD_BUCKETS[i + 1]];
    if (hoursBefore <= h1 && hoursBefore >= h2) {
      const t = (h1 - hoursBefore) / (h1 - h2);
      return curve[i] + t * (curve[i + 1] - curve[i]);
    }
  }
  return 1;
}

// ---------------------------------------------------------------------------
// Forecast
// ---------------------------------------------------------------------------

export interface PulseForecast {
  screeningId: string;
  expected: number;
  low: number;
  high: number;
  capacity: number;
  occupancy: number;
  soldNow: number;
  /** Uncapped demand: can exceed capacity, which is what screen moves look for. */
  demand: number;
  /** Spread behind the range (admissions), after calibration. */
  sd: number;
  /** Sold now against what is usually sold by this point (1 = on track). Null with nothing expected yet. */
  paceIndex: number | null;
  /** Why pace is or isn't shown: 'untimed' when most sales have no sale time (seeded or imported). */
  paceBasis: 'live' | 'early' | 'untimed';
  /** Share of final sales usually sold by now. */
  soldThrough: number;
  confidence: 'low' | 'medium' | 'high';
  baseline: { slot: Slot; label: string; occupancy: number };
  drivers: Driver[];
}

const Z80 = 1.2816;
/** Negative binomial dispersion: cinema attendance is more variable than Poisson. */
export const DISPERSION_R = 8;
const fmtX = (x: number) => `×${x.toFixed(2)}`;

export interface ForecastInput extends ShowFeatures {
  screeningId: string;
  soldNow: number;
  /** Sales with a known sale time (tied to a booking). Pace uses only these; defaults to soldNow. */
  timedSold?: number;
  hoursBefore: number;
  venueName?: string;
  filmTitle?: string;
}

export function forecast(show: ForecastInput, ctx: FilmContext, model: PulseModel): PulseForecast {
  const p = prior(show, ctx);
  const drivers: Driver[] = [...p.drivers];
  let mu = p.mu;
  const learnedLabels: Record<Dimension, (k: string) => string> = {
    venue: () => `At ${show.venueName ?? 'this cinema'}`,
    slot: (k) => SLOT_LABELS[k as Slot],
    dayOfWeek: (k) => DAY_NAMES[Number(k)],
    filmWeekBand: (k) => `Release week ${k} here`,
    film: () => show.filmTitle ?? 'This film',
  };
  for (const d of DIMENSIONS) {
    const cell = model.multipliers[d][keyOf(d, show)];
    if (!cell) continue;
    mu *= cell.m;
    if (Math.abs(cell.m - 1) >= 0.03) drivers.push({ label: `${learnedLabels[d](keyOf(d, show))}: ${fmtX(cell.m)}`, effect: cell.m, explanation: `Learned from ${cell.shows} past show${cell.shows === 1 ? '' : 's'}${cell.m > 1 ? ', selling above the usual pattern' : ', selling below the usual pattern'}.` });
  }
  const F = curveAt(model.curves[show.slot] ?? priorCurve(show.slot), show.hoursBefore);
  // Sales with no sale time (seeded or imported) say nothing about pace, so they only set a floor.
  const timed = Math.min(show.soldNow, show.timedSold ?? show.soldNow);
  const untimedShare = show.soldNow ? 1 - timed / show.soldNow : 0;
  const paceKnown = untimedShare <= 0.5;
  const pace = timed / Math.max(F, 0.05);
  const w = paceKnown ? Math.pow(Math.min(1, F), 0.7) : 0;
  // Without sale times, assume the seats already sold are in and the usual remainder is still to come.
  const demand = paceKnown ? w * pace + (1 - w) * mu : Math.max(mu, show.soldNow + mu * (1 - Math.min(1, F)));
  const expected = Math.min(show.capacity, Math.max(show.soldNow, demand));
  const sd = Math.sqrt(expected + (expected * expected) / DISPERSION_R) * (1 - w * 0.8) * rangeScaleAt(model, show.hoursBefore);
  const low = Math.max(show.soldNow, Math.round(expected - Z80 * sd));
  const high = Math.min(show.capacity, Math.round(expected + Z80 * sd));
  const paceIndex = paceKnown && mu * F > 0.5 ? Math.round((timed / (mu * F)) * 100) / 100 : null;
  if (paceIndex !== null && F > 0.05 && F < 1 && Math.abs(paceIndex - 1) >= 0.15) {
    drivers.push({ label: paceIndex > 1 ? `Selling ahead of pace: ${fmtX(paceIndex)}` : `Selling behind pace: ${fmtX(paceIndex)}`, effect: paceIndex, explanation: `${timed} sold so far; a show like this has usually sold ${Math.round(mu * F)} by now.` });
  }
  const venueShows = model.multipliers.venue[show.venueId]?.shows ?? 0;
  const Fk = paceKnown ? F : 0;
  const confidence = (venueShows >= 200 && Fk >= 0.5) || Fk >= 0.8 ? 'high' : venueShows >= 50 || Fk >= 0.4 ? 'medium' : 'low';
  return {
    screeningId: show.screeningId,
    expected: Math.round(expected),
    low,
    high: Math.max(high, Math.round(expected)),
    capacity: show.capacity,
    occupancy: show.capacity ? Math.round((expected / show.capacity) * 1000) / 1000 : 0,
    soldNow: show.soldNow,
    demand: Math.round(demand),
    sd: Math.round(sd * 100) / 100,
    paceIndex,
    paceBasis: !paceKnown ? 'untimed' : paceIndex === null ? 'early' : 'live',
    soldThrough: Math.round(F * 1000) / 1000,
    confidence,
    baseline: { slot: show.slot, label: SLOT_LABELS[show.slot], occupancy: p.base },
    drivers: drivers.sort((a, b) => Math.abs(Math.log(b.effect || 1)) - Math.abs(Math.log(a.effect || 1))),
  };
}

/** Model expectation for a show from the prior and learned multipliers only (no pace). */
export function expectedFromModel(show: ShowFeatures, ctx: FilmContext | undefined, model: PulseModel): number {
  let mu = ctx ? prior(show, ctx).mu : show.capacity * SLOT_BASE[show.slot];
  for (const d of DIMENSIONS) mu *= model.multipliers[d][keyOf(d, show)]?.m ?? 1;
  return Math.min(show.capacity, mu);
}
