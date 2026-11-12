/*
 * BG/NBD (Fader, Hardie and Lee 2005, "Counting your customers the easy way", Marketing Science
 * 24(2)): while a customer is active they visit as a Poisson process with rate λ ~ Gamma(r, α);
 * after each visit they may drop out with probability p ~ Beta(a, b). Fitted once per operator by
 * maximum likelihood on three numbers per customer:
 *
 *   x    repeat visits (visits after the first)
 *   t_x  weeks from first to last visit
 *   T    weeks from first visit to now
 *
 * It gives each member the chance they are still active and how many visits to expect next, and
 * copes with weekly regulars and twice-a-year families alike, which a fixed "overdue" ratio does
 * not. No dependencies: log-gamma (Lanczos), the Gauss hypergeometric series and Nelder–Mead.
 */

export interface BgParams {
  r: number;
  alpha: number;
  a: number;
  b: number;
}

export interface RfmInput {
  x: number;
  tx: number;
  T: number;
}

const LANCZOS = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];

export function lnGamma(z: number): number {
  if (z < 0.5) return Math.log(Math.PI / Math.abs(Math.sin(Math.PI * z))) - lnGamma(1 - z);
  z -= 1;
  let x = 0.99999999999980993;
  for (let i = 0; i < LANCZOS.length; i++) x += LANCZOS[i] / (z + i + 1);
  const t = z + LANCZOS.length - 0.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
}

const lnBeta = (p: number, q: number) => lnGamma(p) + lnGamma(q) - lnGamma(p + q);

/** Gauss hypergeometric 2F1(a, b; c; z) by its series, for 0 ≤ z < 1. */
export function hyp2f1(a: number, b: number, c: number, z: number): number {
  let term = 1;
  let sum = 1;
  for (let n = 0; n < 2000; n++) {
    term *= ((a + n) * (b + n)) / ((c + n) * (n + 1)) * z;
    sum += term;
    if (Math.abs(term) < 1e-12 * Math.abs(sum)) break;
  }
  return sum;
}

/** Log-likelihood of one customer (Fader, Hardie and Lee 2005, equation 6). */
export function customerLogLik(p: BgParams, c: RfmInput): number {
  const { r, alpha, a, b } = p;
  const base = lnGamma(r + c.x) - lnGamma(r) + r * Math.log(alpha);
  const A1 = lnBeta(a, b + c.x) - lnBeta(a, b) + base - (r + c.x) * Math.log(alpha + c.T);
  if (c.x === 0) return A1;
  const A2 = lnBeta(a + 1, b + c.x - 1) - lnBeta(a, b) + base - (r + c.x) * Math.log(alpha + c.tx);
  const m = Math.max(A1, A2);
  return m + Math.log(Math.exp(A1 - m) + Math.exp(A2 - m));
}

/** Nelder–Mead minimiser, enough for four parameters on the log scale. */
export function nelderMead(f: (v: number[]) => number, start: number[], iterations = 600): number[] {
  const n = start.length;
  let simplex = [start, ...start.map((_, i) => start.map((v, j) => (i === j ? v + 0.5 : v)))].map((v) => ({ v, f: f(v) }));
  for (let it = 0; it < iterations; it++) {
    simplex.sort((p, q) => p.f - q.f);
    if (Math.abs(simplex[n].f - simplex[0].f) < 1e-9) break;
    const centroid = Array.from({ length: n }, (_, j) => simplex.slice(0, n).reduce((s, p) => s + p.v[j], 0) / n);
    const along = (t: number) => centroid.map((c, j) => c + t * (simplex[n].v[j] - c));
    const refl = along(-1);
    const fr = f(refl);
    if (fr < simplex[0].f) {
      const exp = along(-2);
      const fe = f(exp);
      simplex[n] = fe < fr ? { v: exp, f: fe } : { v: refl, f: fr };
    } else if (fr < simplex[n - 1].f) {
      simplex[n] = { v: refl, f: fr };
    } else {
      const con = along(0.5);
      const fc = f(con);
      if (fc < simplex[n].f) simplex[n] = { v: con, f: fc };
      else simplex = simplex.map((p, i) => (i === 0 ? p : { v: p.v.map((x, j) => simplex[0].v[j] + 0.5 * (x - simplex[0].v[j])), f: 0 })).map((p, i) => (i === 0 ? p : { v: p.v, f: f(p.v) }));
    }
  }
  simplex.sort((p, q) => p.f - q.f);
  return simplex[0].v;
}

/** Maximum-likelihood fit. Parameters are searched on the log scale so they stay positive. */
export function fitBgNbd(input: RfmInput[]): BgParams {
  const customers = input.filter((c) => Number.isFinite(c.x) && Number.isFinite(c.tx) && Number.isFinite(c.T) && c.T > 0);
  const toParams = (v: number[]): BgParams => ({ r: Math.exp(v[0]), alpha: Math.exp(v[1]), a: Math.exp(v[2]), b: Math.exp(v[3]) });
  const negLL = (v: number[]) => {
    if (v.some((x) => Math.abs(x) > 12)) return 1e12;
    const p = toParams(v);
    let s = 0;
    for (const c of customers) s += customerLogLik(p, c);
    return Number.isFinite(s) ? -s : 1e12;
  };
  const meanT = customers.reduce((s, c) => s + c.T, 0) / Math.max(1, customers.length);
  const best = nelderMead(negLL, [0, Math.log(Math.max(1, meanT / 4)), 0, Math.log(3)]);
  const p = toParams(best);
  const round = (x: number) => Math.round(x * 10000) / 10000;
  return { r: round(p.r), alpha: round(p.alpha), a: round(p.a), b: round(p.b) };
}

/** Probability the customer is still active (equation 12). */
export function pAlive(p: BgParams, c: RfmInput): number {
  if (c.x === 0) return 1;
  const ratio = (p.a / (p.b + c.x - 1)) * Math.pow((p.alpha + c.T) / (p.alpha + c.tx), p.r + c.x);
  return 1 / (1 + ratio);
}

/** Expected visits in the next `weeks` (equation 10). */
export function expectedVisits(p: BgParams, c: RfmInput, weeks: number): number {
  const { r, alpha, a, b } = p;
  if (Math.abs(a - 1) < 1e-9) return NaN; // equation 10 divides by a − 1
  const z = weeks / (alpha + c.T + weeks);
  const head = ((a + b + c.x - 1) / (a - 1)) * (1 - Math.pow((alpha + c.T) / (alpha + c.T + weeks), r + c.x) * hyp2f1(r + c.x, b + c.x, a + b + c.x - 1, z));
  const tail = c.x > 0 ? 1 + (a / (b + c.x - 1)) * Math.pow((alpha + c.T) / (alpha + c.tx), r + c.x) : 1;
  return head / tail;
}

const WEEK = 7 * 86400_000;

/** x, t_x and T in weeks from a customer's visit dates. */
export function rfmFrom(visits: Date[], now: Date): RfmInput {
  const ts = visits.map((d) => d.getTime()).filter((t) => t <= now.getTime()).sort((p, q) => p - q);
  if (!ts.length) return { x: 0, tx: 0, T: 1e-6 };
  const first = ts[0];
  return { x: ts.length - 1, tx: (ts[ts.length - 1] - first) / WEEK, T: Math.max((now.getTime() - first) / WEEK, 1e-6) };
}
