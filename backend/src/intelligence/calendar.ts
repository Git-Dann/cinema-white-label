import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * Calendar facts Pulse needs: the local day and time of a show, its demand slot,
 * UK bank holidays (gov.uk feed, cached in the database with a fixture fallback)
 * and approximate England & Wales school holidays. Pure apart from loading fixtures.
 */

export type Slot = 'weekday-day' | 'weekday-evening' | 'fri-sat-evening' | 'weekend-day' | 'late';
export const SLOTS: Slot[] = ['weekday-day', 'weekday-evening', 'fri-sat-evening', 'weekend-day', 'late'];
export type Division = 'england-and-wales' | 'scotland' | 'northern-ireland';

export const SLOT_LABELS: Record<Slot, string> = {
  'weekday-day': 'Weekday daytime',
  'weekday-evening': 'Weekday evening',
  'fri-sat-evening': 'Friday or Saturday evening',
  'weekend-day': 'Weekend daytime',
  late: 'Late show',
};
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const FIXTURES = resolve(__dirname, '../../../shared/fixtures/calendar');

/** Local date, weekday and minutes after midnight in a time zone. */
export function localParts(at: Date, timeZone: string): { ymd: string; dow: number; minutes: number; month: number } {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const ymd = `${get('year')}-${get('month')}-${get('day')}`;
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { ymd, dow, minutes: Number(get('hour')) * 60 + Number(get('minute')), month: Number(get('month')) };
}

/** The day after a YYYY-MM-DD date. */
export function nextDay(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Demand slot of a show. Bank holidays behave like Saturdays and the day before one
 * like a Friday; Sunday evening is a weekday evening (school tomorrow). Shows starting
 * at 21:30 or later are late shows.
 */
export function slotOf(dow: number, minutes: number, opts: { bankHoliday?: boolean; dayBeforeBankHoliday?: boolean } = {}): Slot {
  if (minutes >= 21 * 60 + 30) return 'late';
  const evening = minutes >= 17 * 60;
  const saturdayLike = dow === 6 || !!opts.bankHoliday;
  const fridayLike = dow === 5 || (!!opts.dayBeforeBankHoliday && dow !== 0 && !saturdayLike);
  if (evening) return saturdayLike || fridayLike ? 'fri-sat-evening' : 'weekday-evening';
  return saturdayLike || dow === 0 ? 'weekend-day' : 'weekday-day';
}

export const isDaySlot = (s: Slot) => s === 'weekday-day' || s === 'weekend-day';

/** Nation from a UK postcode (bank holidays differ): BT is Northern Ireland, Scottish areas are Scotland. */
export function divisionForPostcode(postcode: string): Division {
  const area = (postcode.trim().toUpperCase().match(/^[A-Z]+/)?.[0] ?? '').slice(0, 2);
  if (area === 'BT') return 'northern-ireland';
  const scottish = ['AB', 'DD', 'DG', 'EH', 'FK', 'G', 'HS', 'IV', 'KA', 'KW', 'KY', 'ML', 'PA', 'PH', 'TD', 'ZE'];
  if (scottish.includes(area) || (area.startsWith('G') && !['GL', 'GU', 'GY'].includes(area))) return 'scotland';
  return 'england-and-wales';
}

export type BankHolidaySet = Record<Division, Set<string>>;

/** Bank holidays from the committed fixture (a snapshot of the gov.uk feed). */
export function fixtureBankHolidays(): BankHolidaySet {
  const json = JSON.parse(readFileSync(resolve(FIXTURES, 'bank-holidays.json'), 'utf8')) as { divisions: Record<Division, { date: string }[]> };
  return toSet(Object.entries(json.divisions).flatMap(([division, events]) => events.map((e) => ({ division, date: e.date }))));
}

export function toSet(rows: { division: string; date: string }[]): BankHolidaySet {
  const out: BankHolidaySet = { 'england-and-wales': new Set(), scotland: new Set(), 'northern-ireland': new Set() };
  for (const r of rows) out[r.division as Division]?.add(r.date);
  return out;
}

/** Parses the gov.uk feed (https://www.gov.uk/bank-holidays.json) into rows. */
export function parseGovUkBankHolidays(json: unknown): { division: Division; date: string; title: string }[] {
  const out: { division: Division; date: string; title: string }[] = [];
  if (!json || typeof json !== 'object') return out;
  for (const division of ['england-and-wales', 'scotland', 'northern-ireland'] as Division[]) {
    const events = (json as Record<string, { events?: { date?: string; title?: string }[] }>)[division]?.events ?? [];
    for (const e of events) if (e.date && /^\d{4}-\d{2}-\d{2}$/.test(e.date)) out.push({ division, date: e.date, title: e.title ?? 'Bank holiday' });
  }
  return out;
}

let schoolRanges: { from: string; to: string; name: string }[] | null = null;

/** Approximate England & Wales school holiday for a date (see the fixture's note). */
export function schoolHoliday(ymd: string): string | null {
  schoolRanges ??= (JSON.parse(readFileSync(resolve(FIXTURES, 'school-holidays-england-wales.json'), 'utf8')) as { ranges: { from: string; to: string; name: string }[] }).ranges;
  return schoolRanges.find((r) => ymd >= r.from && ymd <= r.to)?.name ?? null;
}

/** Everything Pulse needs to know about when a show is. */
export function showCalendar(startsAt: Date, timeZone: string, division: Division, banks: BankHolidaySet) {
  const p = localParts(startsAt, timeZone);
  const set = banks[division];
  const bankHoliday = set.has(p.ymd);
  const dayBeforeBankHoliday = set.has(nextDay(p.ymd));
  return { ...p, bankHoliday, slot: slotOf(p.dow, p.minutes, { bankHoliday, dayBeforeBankHoliday }), schoolHoliday: schoolHoliday(p.ymd) };
}
