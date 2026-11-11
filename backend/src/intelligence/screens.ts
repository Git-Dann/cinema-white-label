import { PulseForecast } from './pulse';

export interface ScreenShow {
  forecast: PulseForecast;
  screeningId: string;
  auditoriumId: string;
  screenName: string;
  filmTitle: string;
  startsAt: Date;
}

export interface ScreenSwap {
  from: { screeningId: string; screenName: string; filmTitle: string; capacity: number; demand: number };
  to: { screeningId: string; screenName: string; filmTitle: string; capacity: number; expected: number };
  extraAdmissions: number;
  reason: string;
}

/**
 * At one cinema: when a show is forecast at least 90% full and a bigger screen starting
 * within 45 minutes is forecast at most 50% full, swapping them should sell more seats.
 */
export function screenSwaps(shows: ScreenShow[]): ScreenSwap[] {
  const out: ScreenSwap[] = [];
  const used = new Set<string>();
  const time = (d: Date) => d.toISOString().slice(11, 16);
  const busy = shows.filter((s) => s.forecast.expected >= 0.9 * s.forecast.capacity).sort((a, b) => b.forecast.demand - a.forecast.demand);
  for (const a of busy) {
    if (used.has(a.screeningId)) continue;
    const options = shows
      .filter((b) => !used.has(b.screeningId) && b.auditoriumId !== a.auditoriumId && b.forecast.capacity > a.forecast.capacity && b.forecast.expected <= 0.5 * b.forecast.capacity && Math.abs(b.startsAt.getTime() - a.startsAt.getTime()) <= 45 * 60_000)
      .map((b) => ({ b, gain: Math.min(a.forecast.demand, b.forecast.capacity) - a.forecast.capacity - Math.max(0, b.forecast.expected - a.forecast.capacity) }))
      .filter((o) => o.gain >= 5)
      .sort((x, y) => y.gain - x.gain);
    const best = options[0];
    if (!best) continue;
    used.add(a.screeningId).add(best.b.screeningId);
    out.push({
      from: { screeningId: a.screeningId, screenName: a.screenName, filmTitle: a.filmTitle, capacity: a.forecast.capacity, demand: a.forecast.demand },
      to: { screeningId: best.b.screeningId, screenName: best.b.screenName, filmTitle: best.b.filmTitle, capacity: best.b.forecast.capacity, expected: best.b.forecast.expected },
      extraAdmissions: Math.round(best.gain),
      reason: `${a.filmTitle} at ${time(a.startsAt)} is forecast to fill ${a.screenName} (${a.forecast.capacity} seats, demand about ${a.forecast.demand}), while ${best.b.screenName} (${best.b.forecast.capacity} seats) is forecast ${Math.round((best.b.forecast.expected / best.b.forecast.capacity) * 100)}% full. Swapping screens should sell about ${Math.round(best.gain)} more seats.`,
    });
  }
  return out;
}
