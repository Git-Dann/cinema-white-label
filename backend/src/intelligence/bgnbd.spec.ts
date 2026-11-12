import { BgParams, customerLogLik, expectedVisits, fitBgNbd, hyp2f1, lnGamma, pAlive, RfmInput, rfmFrom } from './bgnbd';
import { rng } from './outcomes';

/** Simulates customers from the BG/NBD story itself, so the fit has a known truth. */
function simulate(p: BgParams, n: number, weeks: number, seed = 5): RfmInput[] {
  const r = rng(seed);
  const gamma = (shape: number, scale: number): number => {
    // Marsaglia–Tsang, with the shape < 1 boost.
    if (shape < 1) return gamma(shape + 1, scale) * Math.pow(r(), 1 / shape);
    const d = shape - 1 / 3;
    const c = 1 / Math.sqrt(9 * d);
    for (;;) {
      let x: number, v: number;
      do {
        const u1 = r(), u2 = r();
        x = Math.sqrt(-2 * Math.log(u1 || 1e-12)) * Math.cos(2 * Math.PI * u2);
        v = 1 + c * x;
      } while (v <= 0);
      v = v * v * v;
      const u = r();
      if (Math.log(u || 1e-12) < 0.5 * x * x + d - d * v + d * Math.log(v)) return d * v * scale;
    }
  };
  const out: RfmInput[] = [];
  for (let i = 0; i < n; i++) {
    const lambda = gamma(p.r, 1 / p.alpha);
    const ga = gamma(p.a, 1), gb = gamma(p.b, 1);
    const drop = ga / (ga + gb);
    let t = 0, x = 0, tx = 0;
    for (;;) {
      t += -Math.log(r() || 1e-12) / lambda;
      if (t > weeks) break;
      x++;
      tx = t;
      if (r() < drop) break;
    }
    out.push({ x, tx, T: weeks });
  }
  return out;
}

describe('BG/NBD', () => {
  it('has a correct log-gamma and hypergeometric series', () => {
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 10);
    expect(lnGamma(0.5)).toBeCloseTo(Math.log(Math.sqrt(Math.PI)), 10);
    // 2F1(1, 1; 2; z) = −ln(1 − z) / z
    expect(hyp2f1(1, 1, 2, 0.6)).toBeCloseTo(-Math.log(0.4) / 0.6, 8);
  });

  it('recovers known parameters from simulated customers', () => {
    const truth = { r: 0.6, alpha: 4, a: 0.8, b: 2.5 };
    const data = simulate(truth, 2500, 52);
    const fit = fitBgNbd(data);
    expect(fit.r).toBeGreaterThan(0.45);
    expect(fit.r).toBeLessThan(0.8);
    expect(fit.alpha).toBeGreaterThan(2.5);
    expect(fit.alpha).toBeLessThan(6);
    // The fit should explain the data at least as well as the truth does.
    const ll = (p: BgParams) => data.reduce((s, c) => s + customerLogLik(p, c), 0);
    expect(ll(fit)).toBeGreaterThanOrEqual(ll(truth) - 1e-6);
  });

  it('treats a long silence as worrying for a weekly visitor but not for an occasional one', () => {
    const p = { r: 0.6, alpha: 4, a: 0.8, b: 2.5 };
    const weekly = pAlive(p, { x: 20, tx: 30, T: 40 }); // 20 repeat visits, then 10 weeks of silence
    const occasional = pAlive(p, { x: 2, tx: 30, T: 40 }); // 2 repeat visits, same silence
    expect(weekly).toBeLessThan(occasional);
    expect(pAlive(p, { x: 20, tx: 39.5, T: 40 })).toBeGreaterThan(0.9);
    expect(pAlive(p, { x: 0, tx: 0, T: 40 })).toBe(1);
    expect(expectedVisits(p, { x: 20, tx: 39.5, T: 40 }, 13)).toBeGreaterThan(expectedVisits(p, { x: 20, tx: 30, T: 40 }, 13));
  });

  it('builds x, t_x and T in weeks from visit dates', () => {
    const d = (s: string) => new Date(`${s}T19:00:00Z`);
    const c = rfmFrom([d('2026-01-07'), d('2026-01-21'), d('2026-01-14')], d('2026-02-04'));
    expect(c.x).toBe(2);
    expect(c.tx).toBeCloseTo(2, 6);
    expect(c.T).toBeCloseTo(4, 6);
  });
});
