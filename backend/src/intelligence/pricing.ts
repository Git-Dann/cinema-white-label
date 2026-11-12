import { PulseForecast } from './pulse';

/** Most a suggestion will move a price, either way. Operators approve every change. */
export const PRICE_CAPS = { maxRaisePercent: 20, maxDiscountPercent: 30 };

export interface PriceSuggestion {
  screeningId: string;
  action: 'raise' | 'off-peak';
  percent: number;
  reasons: string[];
}

/**
 * Raise when a show within 72 hours is forecast at least 85% full, or is selling 30% ahead
 * of pace and already forecast at least 60% full (pace alone on a near-empty show isn't
 * worth a price rise);
 * suggest off-peak pricing when one under 24 hours away is forecast at most 30% full.
 */
export function priceSuggestion(f: PulseForecast, hoursBefore: number, caps = PRICE_CAPS): PriceSuggestion | null {
  if (hoursBefore <= 0) return null;
  const pct = Math.round(f.occupancy * 100);
  if (hoursBefore <= 72 && (f.occupancy >= 0.85 || ((f.paceIndex ?? 0) >= 1.3 && f.occupancy >= 0.6))) {
    const strong = f.occupancy >= 0.95 || (f.paceIndex ?? 0) >= 1.5;
    const reasons: string[] = [];
    if (f.occupancy >= 0.85) reasons.push(`Forecast ${pct}% full (${f.expected} of ${f.capacity}).`);
    if ((f.paceIndex ?? 0) >= 1.3) reasons.push(`Selling ${Math.round(((f.paceIndex ?? 1) - 1) * 100)}% ahead of a usual show at this point.`);
    return { screeningId: f.screeningId, action: 'raise', percent: Math.min(caps.maxRaisePercent, strong ? 15 : 10), reasons };
  }
  if (hoursBefore < 24 && f.occupancy <= 0.3) {
    return { screeningId: f.screeningId, action: 'off-peak', percent: Math.min(caps.maxDiscountPercent, f.occupancy <= 0.15 ? 25 : 20), reasons: [`Forecast ${pct}% full with under a day to go.`, 'A lower price can fill seats that would otherwise go empty.'] };
  }
  return null;
}
