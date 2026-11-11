import type { Prisma, PrismaClient } from '@prisma/client';
import { zonedToUtc } from '../common/time';
import { BankHolidaySet, Division, divisionForPostcode, fixtureBankHolidays, isDaySlot, parseGovUkBankHolidays, showCalendar, toSet } from './calendar';
import { filmWeekOf, LEAD_BUCKETS, priorCurve, SLOT_BASE, TYPICAL_TIMES } from './pulse';
import { certBand } from './food';

type Db = Pick<PrismaClient, 'showOutcome' | 'screening' | 'screeningSeat' | 'booking' | 'film' | 'venue' | 'auditorium' | 'bankHoliday' | 'tenant' | 'auditoriumLayoutVersion'>;

const DAY = 86400_000;
export const DEMO_TENANTS = ['northlight', 'kestrel'];

// ---------------------------------------------------------------------------
// Bank holidays: gov.uk feed cached in the database, with a committed fixture fallback
// ---------------------------------------------------------------------------

export async function loadBankHolidays(db: Pick<PrismaClient, 'bankHoliday'>): Promise<BankHolidaySet> {
  const rows = await db.bankHoliday.findMany({ select: { division: true, date: true } });
  return rows.length ? toSet(rows) : fixtureBankHolidays();
}

/** Daily cron: refreshes the cache from https://www.gov.uk/bank-holidays.json (Open Government Licence). */
export async function refreshBankHolidays(db: Pick<PrismaClient, 'bankHoliday' | '$transaction'>, fetchJson: () => Promise<unknown> = defaultFetch): Promise<number> {
  const rows = parseGovUkBankHolidays(await fetchJson());
  if (!rows.length) return 0;
  await db.$transaction([db.bankHoliday.deleteMany(), db.bankHoliday.createMany({ data: rows })]);
  return rows.length;
}

async function defaultFetch(): Promise<unknown> {
  const res = await fetch('https://www.gov.uk/bank-holidays.json', { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`gov.uk bank holidays: ${res.status}`);
  return res.json();
}

// ---------------------------------------------------------------------------
// Live rollup
// ---------------------------------------------------------------------------

/** Share of final sales sold by each lead bucket, from booking confirmation times. */
export function leadCurveFrom(startsAt: Date, sales: { at: Date; seats: number }[]): number[] | null {
  const total = sales.reduce((a, s) => a + s.seats, 0);
  if (total < 5) return null;
  return LEAD_BUCKETS.map((h) => {
    const cutoff = startsAt.getTime() - h * 3_600_000;
    const sold = sales.filter((s) => s.at.getTime() <= cutoff).reduce((a, s) => a + s.seats, 0);
    return Math.round((h === 0 ? 1 : sold / total) * 1000) / 1000;
  });
}

/**
 * Builds or refreshes outcome rows for every screening that finished in the last 120 days.
 * Admissions and capacity come from seat inventory (the authority); revenue, food and the
 * booking curve from confirmed bookings.
 */
export async function rollupOutcomes(db: Db, tenantId: string, now: Date, banks?: BankHolidaySet): Promise<number> {
  const bh = banks ?? (await loadBankHolidays(db));
  const screenings = await db.screening.findMany({
    where: { tenantId, status: 'SCHEDULED', endsAt: { gte: new Date(now.getTime() - 120 * DAY), lte: now } },
    include: { venue: { select: { timeZone: true, postcode: true } }, film: { select: { releaseDate: true } } },
  });
  if (!screenings.length) return 0;
  const ids = screenings.map((s) => s.id);
  let written = 0;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const [seats, bookings] = await Promise.all([
      db.screeningSeat.groupBy({ by: ['screeningId', 'state'], where: { screeningId: { in: chunk } }, _count: { _all: true } }),
      db.booking.findMany({
        where: { screeningId: { in: chunk }, status: 'CONFIRMED' },
        select: { screeningId: true, confirmedAt: true, createdAt: true, concessionsMinor: true, seats: { where: { active: true }, select: { priceMinor: true } } },
      }),
    ]);
    const data: Prisma.ShowOutcomeCreateManyInput[] = [];
    for (const s of screenings.filter((x) => chunk.includes(x.id))) {
      const count = (state: string) => seats.find((r) => r.screeningId === s.id && r.state === state)?._count._all ?? 0;
      const capacity = count('AVAILABLE') + count('HELD') + count('SOLD');
      if (!capacity) continue;
      const mine = bookings.filter((b) => b.screeningId === s.id);
      const division = divisionForPostcode(s.venue.postcode);
      const cal = showCalendar(s.startsAt, s.venue.timeZone, division, bh);
      data.push({
        tenantId,
        venueId: s.venueId,
        auditoriumId: s.auditoriumId,
        screeningId: s.id,
        filmId: s.filmId,
        startsAt: s.startsAt,
        capacity,
        admissions: count('SOLD'),
        ticketRevenueMinor: mine.reduce((a, b) => a + b.seats.reduce((x, y) => x + y.priceMinor, 0), 0),
        foodRevenueMinor: mine.reduce((a, b) => a + b.concessionsMinor, 0),
        foodOrders: mine.filter((b) => b.concessionsMinor > 0).length,
        slot: cal.slot,
        dayOfWeek: cal.dow,
        filmWeek: filmWeekOf(s.film.releaseDate, s.startsAt),
        formats: s.formats,
        schoolHoliday: !!cal.schoolHoliday,
        leadCurve: (leadCurveFrom(s.startsAt, mine.map((b) => ({ at: b.confirmedAt ?? b.createdAt, seats: b.seats.length }))) ?? undefined) as Prisma.InputJsonValue | undefined,
        source: 'live',
        computedAt: now,
      });
    }
    await db.showOutcome.deleteMany({ where: { tenantId, screeningId: { in: chunk } } });
    if (data.length) await db.showOutcome.createMany({ data });
    written += data.length;
  }
  return written;
}

// ---------------------------------------------------------------------------
// Demo history (labelled source "demo"; demo operators only)
// ---------------------------------------------------------------------------

/** Small seeded generator so demo history is the same on every run. */
export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hash = (s: string) => [...s].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);
/** Standard normal from two uniforms. */
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(Math.max(1e-9, r()))) * Math.cos(2 * Math.PI * r());

/**
 * 26 weeks of past outcomes per screen for the demo operators, so Pulse has something to
 * learn from before real sales arrive. Generated from a hidden "true" pattern (cinema,
 * weekday and film effects on top of the priors, plus noise) so the model's learned
 * drivers are meaningful. Always stored with source "demo" and reported as such.
 */
export async function ensureDemoHistory(db: Db, now: Date = new Date(), weeks = 26): Promise<number> {
  let written = 0;
  for (const slug of DEMO_TENANTS) {
    const tenant = await db.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!tenant) continue;
    if ((await db.showOutcome.count({ where: { tenantId: tenant.id } })) >= 200) continue;
    const bh = await loadBankHolidays(db);
    const [auditoriums, filmsAll] = await Promise.all([
      db.auditorium.findMany({ where: { tenantId: tenant.id }, include: { venue: { select: { id: true, timeZone: true, postcode: true } }, layouts: { where: { status: 'PUBLISHED' }, select: { seatCount: true }, take: 1 } } }),
      db.film.findMany({ where: { tenantId: tenant.id }, select: { id: true, certificate: true, genres: true, hidden: true }, orderBy: { createdAt: 'asc' } }),
    ]);
    const films = filmsAll.filter((f) => !f.hidden).length >= 4 ? filmsAll.filter((f) => !f.hidden) : filmsAll;
    if (!auditoriums.length || !films.length) continue;
    const r = rng(hash(slug));
    // Hidden truth the model should discover.
    const venueTrue = new Map(auditoriums.map((a) => [a.venue.id, 0.8 + (hash(a.venue.id + slug) % 50) / 100]));
    const dowTrue = [0.95, 0.9, 1.2, 0.85, 0.95, 1.05, 1.0]; // cheap Tuesdays sell better
    const filmTrue = new Map(films.map((f) => [f.id, 0.6 + r() * 1.0]));
    // A demo programme: each film "opens" in turn, so films age through their weeks.
    const start = new Date(now.getTime() - weeks * 7 * DAY);
    const releaseOf = new Map(films.map((f, i) => [f.id, new Date(start.getTime() + (i % 12) * 14 * DAY - 7 * DAY)]));
    const anomalyDays = new Map<string, number>();
    const venues = [...new Set(auditoriums.map((a) => a.venue.id))];
    anomalyDays.set(`${venues[0]}:${ymd(new Date(now.getTime() - 4 * DAY))}`, 1.75);
    if (venues[1]) anomalyDays.set(`${venues[1]}:${ymd(new Date(now.getTime() - 9 * DAY))}`, 0.42);
    const data: Prisma.ShowOutcomeCreateManyInput[] = [];
    for (let d = weeks * 7; d >= 1; d--) {
      const day = ymd(new Date(now.getTime() - d * DAY));
      for (const a of auditoriums) {
        const capacity = a.layouts[0]?.seatCount ?? 120;
        const division: Division = divisionForPostcode(a.venue.postcode);
        for (const [ti, time] of TYPICAL_TIMES.entries()) {
          const startsAt = zonedToUtc(day, time, a.venue.timeZone);
          // Films playing: newest releases get the evening slots on big screens.
          const live = films.filter((f) => releaseOf.get(f.id)!.getTime() <= startsAt.getTime());
          const pool = live.length ? live : films;
          const pick = pool[(hash(a.id + day) + ti * 3) % pool.length];
          const cal = showCalendar(startsAt, a.venue.timeZone, division, bh);
          const filmWeek = filmWeekOf(releaseOf.get(pick.id)!, startsAt);
          const g = pick.genres.map((x) => x.toLowerCase());
          const keep = g.includes('family') || g.includes('animation') ? 0.7 : g.includes('horror') || g.includes('action') ? 0.45 : 0.6;
          const holiday = cal.schoolHoliday && isDaySlot(cal.slot) ? 1.3 : 1;
          const anomaly = anomalyDays.get(`${a.venue.id}:${day}`) ?? 1;
          const occ = SLOT_BASE[cal.slot] * venueTrue.get(a.venue.id)! * dowTrue[cal.dow] * Math.pow(keep, Math.min(10, filmWeek - 1)) * filmTrue.get(pick.id)! * holiday * anomaly * Math.exp(0.25 * gauss(r));
          const admissions = Math.max(0, Math.min(capacity, Math.round(capacity * Math.min(1, occ))));
          const band = certBand(pick.certificate);
          const attach = (band === 'family' ? (isDaySlot(cal.slot) ? 0.55 : 0.45) : band === 'teen' ? 0.38 : 0.28) * (0.85 + r() * 0.3);
          const foodOrders = Math.round(admissions * attach);
          const shift = (r() - 0.5) * 16;
          const curve = priorCurve(cal.slot).map((v, i) => (i === LEAD_BUCKETS.length - 1 ? 1 : Math.max(0, Math.min(1, Math.round((v + shift / 100) * 1000) / 1000))));
          data.push({
            tenantId: tenant.id,
            venueId: a.venue.id,
            auditoriumId: a.id,
            screeningId: null,
            filmId: pick.id,
            startsAt,
            capacity,
            admissions,
            ticketRevenueMinor: admissions * (1050 + Math.round(r() * 250)),
            foodRevenueMinor: foodOrders * (780 + Math.round(r() * 220)),
            foodOrders,
            slot: cal.slot,
            dayOfWeek: cal.dow,
            filmWeek,
            formats: [],
            schoolHoliday: !!cal.schoolHoliday,
            leadCurve: curve as Prisma.InputJsonValue,
            source: 'demo',
            computedAt: now,
          });
        }
      }
    }
    for (let i = 0; i < data.length; i += 2000) await db.showOutcome.createMany({ data: data.slice(i, i + 2000) });
    written += data.length;
  }
  return written;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);
