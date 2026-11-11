/**
 * Staffing from forecast admissions. Most people arrive in the 20-30 minutes before the
 * start: 60% in the final 30 minutes, 30% in the 30 before that, 10% earlier.
 */
export const ARRIVAL_PROFILE = [
  { from: -30, to: 0, share: 0.6 },
  { from: -60, to: -30, share: 0.3 },
  { from: -90, to: -60, share: 0.1 },
];
/** Minutes to serve one arriving customer at a till, and the utilisation we plan for. */
export const SERVICE_MINUTES = 0.75;
export const TARGET_UTILISATION = 0.8;
export const ADMISSIONS_PER_USHER = 120;

export interface StaffShow {
  startsAt: Date;
  expected: number;
}
export interface StaffShift {
  role: string;
  startsAt: Date;
  endsAt: Date;
}
export interface StaffWindow {
  from: string;
  to: string;
  arrivals: number;
  tillsNeeded: number;
  tillsRostered: number;
  ushersNeeded: number;
  ushersRostered: number;
  short: string | null;
}

export function roleKind(role: string): 'till' | 'usher' | 'other' {
  const r = role.toLowerCase();
  if (r.includes('usher') || r.includes('floor')) return 'usher';
  if (['till', 'box', 'concession', 'bar', 'kiosk', 'cashier', 'food', 'café', 'cafe'].some((k) => r.includes(k))) return 'till';
  return 'other';
}

export const tillsFor = (arrivals: number) => (arrivals <= 0 ? 0 : Math.ceil((arrivals * SERVICE_MINUTES) / 30 / TARGET_UTILISATION));

/** 30-minute windows across the day with what's needed and who's rostered. `fmt` turns a Date into local HH:MM. */
export function staffingPlan(shows: StaffShow[], shifts: StaffShift[], fmt: (d: Date) => string): StaffWindow[] {
  if (!shows.length) return [];
  const first = Math.min(...shows.map((s) => s.startsAt.getTime())) - 90 * 60_000;
  const last = Math.max(...shows.map((s) => s.startsAt.getTime()));
  const start = Math.floor(first / 1_800_000) * 1_800_000;
  const out: StaffWindow[] = [];
  for (let t = start; t < last; t += 1_800_000) {
    const end = t + 1_800_000;
    let arrivals = 0;
    let starting = 0;
    for (const s of shows) {
      const st = s.startsAt.getTime();
      for (const band of ARRIVAL_PROFILE) {
        const [bf, bt] = [st + band.from * 60_000, st + band.to * 60_000];
        const overlap = Math.max(0, Math.min(end, bt) - Math.max(t, bf));
        arrivals += (s.expected * band.share * overlap) / 1_800_000;
      }
      if (st >= t && st < end + 1_800_000) starting += s.expected;
    }
    const on = shifts.filter((sh) => sh.startsAt.getTime() < end && sh.endsAt.getTime() > t);
    const tillsRostered = on.filter((sh) => roleKind(sh.role) === 'till').length;
    const ushersRostered = on.filter((sh) => roleKind(sh.role) === 'usher').length;
    const tillsNeeded = tillsFor(arrivals);
    const ushersNeeded = starting > 0 ? Math.ceil(starting / ADMISSIONS_PER_USHER) : 0;
    const gaps: string[] = [];
    if (tillsNeeded > tillsRostered) gaps.push(`${tillsNeeded - tillsRostered} on tills`);
    if (ushersNeeded > ushersRostered) gaps.push(`${ushersNeeded - ushersRostered} ushering`);
    out.push({ from: fmt(new Date(t)), to: fmt(new Date(end)), arrivals: Math.round(arrivals), tillsNeeded, tillsRostered, ushersNeeded, ushersRostered, short: gaps.length ? `Short ${gaps.join(' and ')}` : null });
  }
  return out.filter((w) => w.arrivals > 0 || w.ushersNeeded > 0);
}
