export interface DayResult {
  venueId: string;
  venueName: string;
  date: string;
  actual: number;
  forecast: number;
}
export interface Anomaly extends DayResult {
  ratio: number;
  z: number;
  sentence: string;
}

/**
 * Days that sold unusually far from forecast. Uses the log of actual ÷ forecast and a
 * robust z-score (median and median absolute deviation), so one odd day can't hide another.
 */
export function anomalies(days: DayResult[], threshold = 2.5): Anomaly[] {
  const usable = days.filter((d) => d.forecast > 0 && d.actual >= 0);
  if (usable.length < 5) return [];
  const x = usable.map((d) => Math.log((d.actual + 1) / (d.forecast + 1)));
  const med = median(x);
  const mad = median(x.map((v) => Math.abs(v - med))) || 0.05;
  return usable
    .map((d, i) => {
      const z = (x[i] - med) / (1.4826 * mad);
      const ratio = d.actual / d.forecast;
      const pct = Math.round(Math.abs(ratio - 1) * 100);
      const when = new Date(`${d.date}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
      return { ...d, ratio: Math.round(ratio * 100) / 100, z: Math.round(z * 10) / 10, sentence: `${d.venueName}, ${when}: ${d.actual} admissions, ${pct}% ${ratio >= 1 ? 'above' : 'below'} forecast.` };
    })
    .filter((a) => Math.abs(a.z) >= threshold)
    .sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}

function median(xs: number[]) {
  const a = [...xs].sort((p, q) => p - q);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}
