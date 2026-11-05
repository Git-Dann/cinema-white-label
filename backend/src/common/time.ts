/** Time zone helpers. Screening times are stored in UTC and presented in the venue's zone. */

function offsetMinutes(at: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - at.getTime()) / 60000);
}

/** Converts a wall-clock time in `timeZone` to a UTC Date. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = new Date(Date.UTC(y, m - 1, d, hh, mm));
  const off = offsetMinutes(guess, timeZone);
  const result = new Date(guess.getTime() - off * 60000);
  // Re-check across DST boundaries.
  const off2 = offsetMinutes(result, timeZone);
  return off2 === off ? result : new Date(guess.getTime() - off2 * 60000);
}

/** UTC bounds [start, end) of a local calendar day. */
export function zonedDayBounds(date: string, timeZone: string): { start: Date; end: Date } {
  const start = zonedToUtc(date, '00:00', timeZone);
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
  return { start, end: zonedToUtc(next, '00:00', timeZone) };
}

/** Local YYYY-MM-DD for an instant in a time zone. */
export function zonedDate(at: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);
}
