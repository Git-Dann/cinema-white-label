/*
 * The night's choice model: shows at one cinema on the same part of the day compete for the
 * same people. Seatfold models that with a two-level CES (nested-logit style) aggregator:
 *
 *   film f's pull     P_f = ( Σ_{i ∈ f} μ_i^(1/λ_film) )^λ_film
 *   the session's     T   = ( Σ_f P_f^(1/λ_cross) )^λ_cross
 *   show i's share    T × (P_f^(1/λ_cross) / Σ_g P_g^(1/λ_cross)) × (μ_i^(1/λ_film) / Σ_{j ∈ f} μ_j^(1/λ_film))
 *
 * μ_i is Pulse's standalone demand for the show. λ = 1 means shows add up (no competition);
 * λ near 0 means extra shows only split the same audience. A second showing of the same film
 * close in time mostly splits its audience (λ_film small); a different film brings some new
 * people and takes some from the others (λ_cross larger). Pulse's standalone forecasts were
 * learned on programmes that already had their usual competition, so the model is used for
 * differences: what changes when a show is added, removed, moved or repriced.
 */

export interface ChoiceParams {
  /** Nesting for shows of the same film in one session. */
  lambdaFilm: number;
  /** Nesting across films in one session. */
  lambdaCross: number;
  /** Shows starting within this many minutes compete. */
  sessionMinutes: number;
  /** Own-price elasticity of attendance for one show (negative). */
  priceElasticity: number;
  /** Share of turned-away demand that moves to another show of the same film that night. */
  spillToSameFilm: number;
}

/**
 * Defaults from docs/research/pulse-behaviour-evidence.md (section 1 and 5):
 * - lambdaCross 0.5: Einav (2007) nested logit puts the films-versus-not-going correlation at
 *   σ = 0.52, so 1 − σ ≈ 0.48 (range 0.40 to 0.75).
 * - lambdaFilm 0.3: an assumption, informed by 62 to 75% of UK customers choosing the film
 *   before the cinema (Competition Commission 2013 survey, p.22).
 * - priceElasticity −0.7: market-level response, because the nest already moves people
 *   between shows; a single show on its own is closer to −2.
 * Every simulation lists them, so nobody mistakes an assumption for a measurement. Each
 * operator's own values will be fitted from their history (planned: Einav two-stage fit).
 */
export const DEFAULT_CHOICE: ChoiceParams = { lambdaFilm: 0.3, lambdaCross: 0.5, sessionMinutes: 150, priceElasticity: -0.7, spillToSameFilm: 0.5 };

export interface NightShow {
  id: string;
  filmId: string;
  /** Start, ms since epoch. */
  start: number;
  capacity: number;
  /** Standalone demand from Pulse (uncapped). */
  demand: number;
  /** Average ticket price in minor units, for revenue. */
  priceMinor: number;
}

export interface ShowOutcome {
  id: string;
  filmId: string;
  demand: number;
  admissions: number;
  turnedAway: number;
}

/** Groups shows into sessions: chains of shows each starting within sessionMinutes of the previous one. */
export function sessions(shows: NightShow[], minutes: number): NightShow[][] {
  const sorted = [...shows].sort((a, b) => a.start - b.start);
  const out: NightShow[][] = [];
  for (const s of sorted) {
    const cur = out[out.length - 1];
    if (cur && s.start - cur[cur.length - 1].start <= minutes * 60_000) cur.push(s);
    else out.push([s]);
  }
  return out;
}

const pow = (x: number, e: number) => (x > 0 ? Math.pow(x, e) : 0);

/** Demand per show after competition within its session (before capacity). */
export function allocate(session: NightShow[], p: ChoiceParams): Map<string, number> {
  const byFilm = new Map<string, NightShow[]>();
  for (const s of session) byFilm.set(s.filmId, [...(byFilm.get(s.filmId) ?? []), s]);
  const pulls = new Map<string, number>();
  for (const [f, list] of byFilm) pulls.set(f, pow(list.reduce((a, s) => a + pow(s.demand, 1 / p.lambdaFilm), 0), p.lambdaFilm));
  const crossSum = [...pulls.values()].reduce((a, x) => a + pow(x, 1 / p.lambdaCross), 0);
  const total = pow(crossSum, p.lambdaCross);
  const out = new Map<string, number>();
  for (const [f, list] of byFilm) {
    const filmShare = crossSum ? pow(pulls.get(f)!, 1 / p.lambdaCross) / crossSum : 0;
    const within = list.reduce((a, s) => a + pow(s.demand, 1 / p.lambdaFilm), 0);
    for (const s of list) out.set(s.id, within ? total * filmShare * (pow(s.demand, 1 / p.lambdaFilm) / within) : 0);
  }
  return out;
}

/** Admissions for a whole night, with capacity caps and spill to other shows of the same film. */
export function playNight(shows: NightShow[], p: ChoiceParams): ShowOutcome[] {
  const raw = new Map<string, number>();
  for (const sess of sessions(shows, p.sessionMinutes)) for (const [id, d] of allocate(sess, p)) raw.set(id, d);
  const res = new Map<string, ShowOutcome>(shows.map((s) => [s.id, { id: s.id, filmId: s.filmId, demand: raw.get(s.id) ?? 0, admissions: 0, turnedAway: 0 }]));
  for (const s of shows) {
    const r = res.get(s.id)!;
    r.admissions = Math.min(s.capacity, r.demand);
    r.turnedAway = Math.max(0, r.demand - s.capacity);
  }
  // Some of those turned away take another showing of the same film, if it has room.
  for (const s of shows) {
    const r = res.get(s.id)!;
    if (r.turnedAway <= 0) continue;
    let moving = r.turnedAway * p.spillToSameFilm;
    for (const o of shows.filter((x) => x.filmId === s.filmId && x.id !== s.id).sort((a, b) => Math.abs(a.start - s.start) - Math.abs(b.start - s.start))) {
      const ro = res.get(o.id)!;
      const room = o.capacity - ro.admissions;
      const take = Math.min(room, moving);
      if (take > 0) {
        ro.admissions += take;
        moving -= take;
      }
      if (moving <= 0) break;
    }
  }
  return [...res.values()];
}

export type Change =
  | { kind: 'add'; show: NightShow }
  | { kind: 'remove'; showId: string }
  | { kind: 'move'; showId: string; capacity: number }
  | { kind: 'price'; showId: string; percent: number };

export interface Simulation {
  before: { admissions: number; revenueMinor: number; turnedAway: number };
  after: { admissions: number; revenueMinor: number; turnedAway: number };
  change: { admissions: number; revenueMinor: number };
  /** For an added show: how many of its audience came from other shows that night. */
  takenFromOthers: number;
  shows: { id: string; filmId: string; before: number; after: number }[];
  assumptions: string[];
}

const r1 = (x: number) => Math.round(x * 10) / 10;

export function simulate(shows: NightShow[], change: Change, p: ChoiceParams = DEFAULT_CHOICE): Simulation {
  let next = shows.map((s) => ({ ...s }));
  if (change.kind === 'add') next.push({ ...change.show });
  if (change.kind === 'remove') next = next.filter((s) => s.id !== change.showId);
  if (change.kind === 'move') next = next.map((s) => (s.id === change.showId ? { ...s, capacity: change.capacity } : s));
  if (change.kind === 'price') {
    // Constant-elasticity response for the repriced show; the choice model moves people between shows.
    next = next.map((s) => (s.id === change.showId ? { ...s, demand: s.demand * Math.pow(1 + change.percent / 100, p.priceElasticity), priceMinor: Math.round(s.priceMinor * (1 + change.percent / 100)) } : s));
  }
  const a = playNight(shows, p);
  const b = playNight(next, p);
  const sum = (list: ShowOutcome[], set: NightShow[]) => ({
    admissions: list.reduce((x, o) => x + o.admissions, 0),
    revenueMinor: list.reduce((x, o) => x + o.admissions * (set.find((s) => s.id === o.id)?.priceMinor ?? 0), 0),
    turnedAway: list.reduce((x, o) => x + o.turnedAway, 0),
  });
  const before = sum(a, shows);
  const after = sum(b, next);
  const ids = new Set([...shows.map((s) => s.id), ...next.map((s) => s.id)]);
  const rows = [...ids].map((id) => ({ id, filmId: (next.find((s) => s.id === id) ?? shows.find((s) => s.id === id))!.filmId, before: r1(a.find((o) => o.id === id)?.admissions ?? 0), after: r1(b.find((o) => o.id === id)?.admissions ?? 0) }));
  const added = change.kind === 'add' ? b.find((o) => o.id === change.show.id)?.admissions ?? 0 : 0;
  const assumptions = [
    `Shows starting within ${Math.round(p.sessionMinutes / 6) / 10} hours of each other compete for the same audience.`,
    `Another showing of the same film mostly splits its audience (nesting ${p.lambdaFilm}); a different film draws some new people (nesting ${p.lambdaCross}).`,
    `Half of the people turned away from a full show take another showing of the same film if it has seats.`,
  ];
  if (change.kind === 'price') assumptions.push(`Attendance moves ${Math.abs(p.priceElasticity)}% for each 1% change in price on that show.`);
  return {
    before: { admissions: Math.round(before.admissions), revenueMinor: Math.round(before.revenueMinor), turnedAway: Math.round(before.turnedAway) },
    after: { admissions: Math.round(after.admissions), revenueMinor: Math.round(after.revenueMinor), turnedAway: Math.round(after.turnedAway) },
    change: { admissions: Math.round(after.admissions - before.admissions), revenueMinor: Math.round(after.revenueMinor - before.revenueMinor) },
    takenFromOthers: change.kind === 'add' ? Math.max(0, Math.round(added - (after.admissions - before.admissions))) : 0,
    shows: rows,
    assumptions,
  };
}
