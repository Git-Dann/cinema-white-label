import { allocate, DEFAULT_CHOICE, NightShow, playNight, sessions, simulate } from './choice';

const H = 3600_000;
const T0 = Date.UTC(2026, 10, 14, 18);
const show = (id: string, filmId: string, hours: number, demand: number, capacity = 200, priceMinor = 1000): NightShow => ({ id, filmId, start: T0 + hours * H, capacity, demand, priceMinor });

describe('Choice model', () => {
  it('adds up exactly when there is no competition (both nestings 1)', () => {
    const p = { ...DEFAULT_CHOICE, lambdaFilm: 1, lambdaCross: 1 };
    const out = allocate([show('a', 'f1', 0, 60), show('b', 'f2', 0.5, 40)], p);
    expect(out.get('a')).toBeCloseTo(60, 6);
    expect(out.get('b')).toBeCloseTo(40, 6);
  });

  it('groups shows into sessions by start time', () => {
    const s = sessions([show('a', 'f', 0, 1), show('b', 'f', 2, 1), show('c', 'f', 5, 1)], 150);
    expect(s.map((x) => x.map((y) => y.id))).toEqual([['a', 'b'], ['c']]);
  });

  it('a second showing of the same film adds far less than a different film would', () => {
    const night = [show('a', 'f1', 0, 80)];
    const same = simulate(night, { kind: 'add', show: show('n', 'f1', 0.5, 80) });
    const other = simulate(night, { kind: 'add', show: show('n', 'f2', 0.5, 80) });
    expect(same.change.admissions).toBeGreaterThan(0);
    expect(other.change.admissions).toBeGreaterThan(same.change.admissions * 2);
    expect(same.takenFromOthers).toBeGreaterThan(other.takenFromOthers);
    expect(same.assumptions.length).toBeGreaterThanOrEqual(3);
  });

  it('a show in a separate session does not compete', () => {
    const r = simulate([show('a', 'f1', 0, 80)], { kind: 'add', show: show('n', 'f1', 5, 50) });
    expect(r.change.admissions).toBe(50);
    expect(r.takenFromOthers).toBe(0);
  });

  it('caps at capacity, sends some of the overflow to another showing, and values a bigger screen', () => {
    const night = [show('a', 'f1', 0, 300, 100), show('b', 'f1', 1.5, 20, 100)];
    const played = playNight(night, DEFAULT_CHOICE);
    const a = played.find((o) => o.id === 'a')!;
    expect(a.admissions).toBe(100);
    expect(a.turnedAway).toBeGreaterThan(0);
    const moved = simulate(night, { kind: 'move', showId: 'a', capacity: 250 });
    expect(moved.change.admissions).toBeGreaterThan(0);
    expect(moved.after.turnedAway).toBeLessThan(moved.before.turnedAway);
  });

  it('prices with a constant elasticity and reports revenue', () => {
    const night = [show('a', 'f1', 0, 50, 200, 1000)];
    const cut = simulate(night, { kind: 'price', showId: 'a', percent: -20 });
    expect(cut.change.admissions).toBeGreaterThan(0);
    expect(cut.after.revenueMinor).toBeLessThan(cut.before.revenueMinor); // elasticity below 1: a cut loses revenue on this show
    expect(cut.assumptions.some((a) => a.includes('price'))).toBe(true);
    const remove = simulate(night, { kind: 'remove', showId: 'a' });
    expect(remove.after.admissions).toBe(0);
  });
});
