import { Injectable } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { imageRef, pickAsset } from '../catalogue/film-dto';
import { Clock } from '../common/clock';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { zonedDayBounds, zonedToUtc } from '../common/time';
import { anomalies } from './anomalies';
import { basketRules } from './baskets';
import { BankHolidaySet, DAY_NAMES, divisionForPostcode, localParts, Slot, SLOT_LABELS, showCalendar } from './calendar';
import { demoBaskets, demoCustomers } from './demo';
import { interestStrength, median } from './interest';
import { backtest, BacktestResult, calibrateRanges } from './backtest';
import { Change, DEFAULT_CHOICE, NightShow, simulate } from './choice';
import { filmRun, FilmRun, weeklyRows } from './filmrun';
import { BgParams, fitBgNbd, rfmFrom } from './bgnbd';
import { attachRates, MixItem, prepForShow, productMix } from './food';
import { CustomerHistory, scoreCustomers, segmentSummary } from './loyalty';
import { DEMO_TENANTS, loadBankHolidays } from './outcomes';
import { priceSuggestion, PRICE_CAPS } from './pricing';
import { DIMENSIONS, expectedFromModel, FilmContext, filmWeekOf, fitModel, forecast, LEAD_BUCKETS, OutcomeRow, popularityRanks, PulseForecast, tmdbPopularityLicensed, PulseModel, SHRINKAGE_K, SLOT_BASE, TARGET_WEEKLY_OCCUPANCY } from './pulse';
import { alsoBooked, audiences, recommend, RecFilm } from './recommendations';
import { screenSwaps } from './screens';
import { staffingPlan } from './staffing';

const DAY = 86400_000;
const MODEL_TTL = 10 * 60_000;

export interface Basis {
  liveShows: number;
  demoShows: number;
  weeks: number;
  /** Plain-English summary for the UI, e.g. "Based on 26 weeks of demo history". */
  note: string;
}

export type SimulateBody = {
  venueId: string;
  date?: string;
  change: { kind: 'add'; filmId: string; auditoriumId: string; time: string } | { kind: 'remove'; screeningId: string } | { kind: 'move'; screeningId: string; auditoriumId: string } | { kind: 'price'; screeningId: string; percent: number };
};

interface Ctx {
  at: number;
  model: PulseModel;
  films: Map<string, FilmContext & { slug: string; posterUrl: string | null; hidden: boolean }>;
  banks: BankHolidaySet;
  venues: Map<string, { name: string; timeZone: string; postcode: string }>;
  outcomes: (OutcomeRow & { certificate: string; foodOrders: number })[];
  /** Backtest, computed on first request and kept with this fit. */
  accuracy?: BacktestResult;
}

/**
 * Loads data for Pulse, fits the model (cached per operator for 10 minutes) and runs the
 * pure modules. Everything is scoped to one operator.
 */
@Injectable()
export class PulseService {
  private cache = new Map<string, Ctx>();
  private readonly bgCache = new Map<string, { key: string; at: number; params: BgParams }>();

  constructor(private readonly prisma: PrismaService, private readonly clock: Clock) {}

  invalidate(tenantId: string) {
    this.cache.delete(tenantId);
  }

  private async context(t: Tenant): Promise<Ctx> {
    const hit = this.cache.get(t.id);
    const now = this.clock.now();
    if (hit && now.getTime() - hit.at < MODEL_TTL) return hit;
    const [films, venues, rows, banks] = await Promise.all([
      this.prisma.film.findMany({ where: { tenantId: t.id }, include: { assets: true, interest: true } }),
      this.prisma.venue.findMany({ where: { tenantId: t.id }, select: { id: true, name: true, timeZone: true, postcode: true } }),
      this.prisma.showOutcome.findMany({ where: { tenantId: t.id, startsAt: { gte: new Date(now.getTime() - 365 * DAY) } } }),
      loadBankHolidays(this.prisma),
    ]);
    const facts = films.map((f) => ({ id: f.id, title: f.title, genres: f.genres, certificate: f.certificate, releaseDate: f.releaseDate, popularity: numberOrNull((f.provenance as Record<string, unknown>)?.popularity), series: f.interest?.series ?? false }));
    // Audience interest against the typical (median) film this operator is showing.
    const typical = median(films.filter((f) => !f.hidden && f.interest).map((f) => f.interest!.views));
    const interestOf = (f: (typeof films)[number]) =>
      f.interest && f.interest.views > 0 && typical > 0 ? { views: f.interest.views, typical, strength: interestStrength(f.interest.views, typical), source: f.interest.source as 'wikipedia' | 'demo' } : undefined;
    // Off unless licensed (see tmdbPopularityLicensed): each film's own sales still teach its learned multiplier.
    const ranks = tmdbPopularityLicensed() ? popularityRanks(facts.filter((f) => !films.find((x) => x.id === f.id)!.hidden)) : new Map<string, number>();
    const filmMap = new Map(
      facts.map((f) => {
        const full = films.find((x) => x.id === f.id)!;
        return [f.id, { film: f, rank: ranks.get(f.id), interest: interestOf(full), slug: full.slug, hidden: full.hidden, posterUrl: imageRef(pickAsset(full.assets, 'POSTER', now))?.url ?? null }];
      }),
    );
    const outcomes = rows.map((r) => ({
      venueId: r.venueId,
      filmId: r.filmId,
      capacity: r.capacity,
      slot: r.slot as Slot,
      dayOfWeek: r.dayOfWeek,
      filmWeek: r.filmWeek,
      formats: r.formats,
      schoolHoliday: r.schoolHoliday ? 'School holiday' : null,
      admissions: r.admissions,
      leadCurve: Array.isArray(r.leadCurve) ? (r.leadCurve as number[]) : null,
      source: r.source as 'live' | 'demo',
      startsAt: r.startsAt,
      certificate: filmMap.get(r.filmId)?.film.certificate ?? 'TBC',
      foodOrders: r.foodOrders,
    }));
    const fitted = fitModel(outcomes, filmMap);
    const model = { ...fitted, rangeScale: calibrateRanges(outcomes, filmMap, fitted) };
    const ctx: Ctx = { at: now.getTime(), model, films: filmMap, banks, venues: new Map(venues.map((v) => [v.id, v])), outcomes };
    this.cache.set(t.id, ctx);
    return ctx;
  }

  private basis(model: PulseModel): Basis {
    const weeks = model.from && model.to ? Math.max(1, Math.round((new Date(model.to).getTime() - new Date(model.from).getTime()) / (7 * DAY))) : 0;
    const note = !model.shows
      ? 'No history yet: forecasts use industry priors only.'
      : model.liveShows && model.demoShows
        ? `Based on ${model.liveShows} live shows and ${model.demoShows} demo shows over ${weeks} week${weeks === 1 ? '' : 's'}.`
        : model.demoShows
          ? `Based on ${weeks} week${weeks === 1 ? '' : 's'} of demo history (${model.demoShows} shows).`
          : `Based on ${weeks} week${weeks === 1 ? '' : 's'} of your sales (${model.liveShows} shows).`;
    return { liveShows: model.liveShows, demoShows: model.demoShows, weeks, note };
  }

  /** Forecasts for upcoming screenings, with the context the modules need. */
  private async upcoming(t: Tenant, ctx: Ctx, from: Date, to: Date, venueId?: string) {
    if (venueId && !ctx.venues.has(venueId)) throw Errors.notFound('Cinema');
    const now = this.clock.now();
    const screenings = await this.prisma.screening.findMany({
      where: { tenantId: t.id, status: 'SCHEDULED', startsAt: { gte: from, lt: to }, ...(venueId ? { venueId } : {}) },
      include: { auditorium: { select: { name: true } } },
      orderBy: { startsAt: 'asc' },
      take: 3000,
    });
    const ids = screenings.map((s) => s.id);
    const seats = ids.length ? await this.prisma.screeningSeat.groupBy({ by: ['screeningId', 'state'], where: { screeningId: { in: ids } }, _count: { _all: true } }) : [];
    const count = (id: string, state: string) => seats.find((r) => r.screeningId === id && r.state === state)?._count._all ?? 0;
    // Only sales tied to a booking have a real sale time; seeded or imported seats do not, so they cannot show pace.
    const timed = ids.length ? await this.prisma.screeningSeat.groupBy({ by: ['screeningId'], where: { screeningId: { in: ids }, state: 'SOLD', bookingId: { not: null } }, _count: { _all: true } }) : [];
    const timedSold = (id: string) => timed.find((r) => r.screeningId === id)?._count._all ?? 0;
    return screenings.map((s) => {
      const v = ctx.venues.get(s.venueId)!;
      const fc = ctx.films.get(s.filmId);
      const cal = showCalendar(s.startsAt, v.timeZone, divisionForPostcode(v.postcode), ctx.banks);
      const capacity = count(s.id, 'AVAILABLE') + count(s.id, 'HELD') + count(s.id, 'SOLD');
      const input = {
        screeningId: s.id,
        venueId: s.venueId,
        filmId: s.filmId,
        capacity,
        slot: cal.slot,
        dayOfWeek: cal.dow,
        filmWeek: fc ? filmWeekOf(fc.film.releaseDate, s.startsAt) : 1,
        formats: s.formats,
        schoolHoliday: cal.schoolHoliday,
        soldNow: count(s.id, 'SOLD'),
        timedSold: timedSold(s.id),
        hoursBefore: (s.startsAt.getTime() - now.getTime()) / 3_600_000,
        venueName: v.name,
        filmTitle: fc?.film.title,
      };
      const f: PulseForecast = fc ? forecast(input, fc, ctx.model) : forecast(input, { film: { id: s.filmId, title: 'Film', genres: [], certificate: 'TBC', releaseDate: s.startsAt } }, ctx.model);
      return {
        screening: s,
        input,
        forecast: f,
        summary: {
          screeningId: s.id,
          startsAt: s.startsAt.toISOString(),
          localTime: `${pad(Math.floor(cal.minutes / 60))}:${pad(cal.minutes % 60)}`,
          localDate: cal.ymd,
          venue: { id: s.venueId, name: v.name },
          screen: { id: s.auditoriumId, name: s.auditorium.name },
          film: { id: s.filmId, title: fc?.film.title ?? 'Film', certificate: fc?.film.certificate ?? 'TBC' },
          slot: cal.slot,
          bankHoliday: cal.bankHoliday,
          schoolHoliday: cal.schoolHoliday,
        },
      };
    });
  }

  async forecasts(t: Tenant, q: { venueId?: string; from?: string; to?: string }) {
    const ctx = await this.context(t);
    const now = this.clock.now();
    const from = parseDate(q.from) ?? now;
    const to = new Date(Math.min((parseDate(q.to) ?? new Date(from.getTime() + 14 * DAY)).getTime(), from.getTime() + 42 * DAY));
    const rows = await this.upcoming(t, ctx, from, to, q.venueId);
    const daily = new Map<string, { date: string; venueId: string; expected: number; capacity: number; soldNow: number; shows: number }>();
    for (const r of rows) {
      const k = `${r.summary.venue.id}:${r.summary.localDate}`;
      const d = daily.get(k) ?? { date: r.summary.localDate, venueId: r.summary.venue.id, expected: 0, capacity: 0, soldNow: 0, shows: 0 };
      d.expected += r.forecast.expected;
      d.capacity += r.forecast.capacity;
      d.soldNow += r.forecast.soldNow;
      d.shows++;
      daily.set(k, d);
    }
    return { basis: this.basis(ctx.model), from: from.toISOString(), to: to.toISOString(), daily: [...daily.values()], forecasts: rows.map((r) => ({ ...r.summary, ...r.forecast })) };
  }

  /**
   * Price ideas for single shows, each checked with the night's choice model before it is
   * offered: only changes that should earn more (tickets plus food) are suggested. The rest are
   * counted, so the page can say how many ideas were checked and rejected.
   */
  async pricing(t: Tenant) {
    const ctx = await this.context(t);
    const now = this.clock.now();
    const rows = await this.upcoming(t, ctx, now, new Date(now.getTime() + 7 * DAY));
    const { night, perHead } = await this.nights(t, rows);
    let checked = 0;
    const suggestions = rows.flatMap((r) => {
      const s = priceSuggestion(r.forecast, r.input.hoursBefore);
      if (!s) return [];
      checked++;
      const percent = s.action === 'raise' ? s.percent : -s.percent;
      const sim = simulate(night(r.summary.venue.id, r.summary.localDate), { kind: 'price', showId: r.screening.id, percent }, DEFAULT_CHOICE);
      const food = sim.change.admissions * perHead(r.summary.venue.id).food;
      const impactMinor = sim.change.revenueMinor + food;
      if (impactMinor <= 0) return [];
      return [{ ...r.summary, ...s, impact: { admissions: sim.change.admissions, ticketMinor: sim.change.revenueMinor, foodMinor: food, totalMinor: impactMinor }, forecast: { expected: r.forecast.expected, capacity: r.forecast.capacity, occupancy: r.forecast.occupancy, paceIndex: r.forecast.paceIndex } }];
    });
    return { basis: this.basis(ctx.model), caps: PRICE_CAPS, checked, rejected: checked - suggestions.length, suggestions: suggestions.sort((a, b) => b.impact.totalMinor - a.impact.totalMinor) };
  }

  /** Night-level inputs for the choice model, with each cinema's spend per head from the last 90 days. */
  private async nights(t: Tenant, rows: Awaited<ReturnType<PulseService['upcoming']>>) {
    const now = this.clock.now();
    const spend = await this.prisma.showOutcome.groupBy({ by: ['venueId'], where: { tenantId: t.id, startsAt: { gte: new Date(now.getTime() - 90 * DAY) } }, _sum: { ticketRevenueMinor: true, foodRevenueMinor: true, admissions: true } });
    const perHead = (venueId: string) => {
      const x = spend.find((r) => r.venueId === venueId)?._sum;
      const n = x?.admissions ?? 0;
      return { ticket: n ? Math.round((x!.ticketRevenueMinor ?? 0) / n) : 1000, food: n ? Math.round((x!.foodRevenueMinor ?? 0) / n) : 400 };
    };
    const night = (venueId: string, date: string): NightShow[] =>
      rows.filter((r) => r.summary.venue.id === venueId && r.summary.localDate === date).map((r) => ({ id: r.screening.id, filmId: r.screening.filmId, start: r.screening.startsAt.getTime(), capacity: r.forecast.capacity, demand: r.forecast.demand, priceMinor: perHead(venueId).ticket }));
    return { night, perHead };
  }

  async screens(t: Tenant) {
    const ctx = await this.context(t);
    const now = this.clock.now();
    const rows = await this.upcoming(t, ctx, now, new Date(now.getTime() + 3 * DAY));
    const byVenue = new Map<string, typeof rows>();
    for (const r of rows) byVenue.set(r.summary.venue.id, [...(byVenue.get(r.summary.venue.id) ?? []), r]);
    const swaps = [...byVenue.values()].flatMap((list) =>
      screenSwaps(list.map((r) => ({ forecast: r.forecast, screeningId: r.summary.screeningId, auditoriumId: r.summary.screen.id, screenName: r.summary.screen.name, filmTitle: r.summary.film.title, startsAt: r.screening.startsAt }))).map((s) => {
        const from = rows.find((r) => r.summary.screeningId === s.from.screeningId)!;
        return { venue: from.summary.venue, localDate: from.summary.localDate, localTime: from.summary.localTime, ...s };
      }),
    );
    return { basis: this.basis(ctx.model), swaps };
  }

  private async venueDay(t: Tenant, venueId: string | undefined, date: string | undefined) {
    if (!venueId) throw Errors.validation('Choose a cinema (venueId)');
    const ctx = await this.context(t);
    const v = ctx.venues.get(venueId);
    if (!v) throw Errors.notFound('Cinema');
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : localParts(this.clock.now(), v.timeZone).ymd;
    const { start, end } = zonedDayBounds(day, v.timeZone);
    const rows = await this.upcoming(t, ctx, start, end, venueId);
    return { ctx, v, day, start, end, rows };
  }

  /**
   * What-if for one cinema-day: add, remove or move a show, or change its price. Pulse forecasts
   * each show, then the night's choice model (choice.ts) works out what the change does to the
   * whole programme, including audience taken from other shows. Nothing is changed.
   */
  async simulate(t: Tenant, body: SimulateBody) {
    const { ctx, v, day, rows } = await this.venueDay(t, body.venueId, body.date);
    const now = this.clock.now();
    const priceRow = await this.prisma.showOutcome.aggregate({ where: { tenantId: t.id, venueId: body.venueId, startsAt: { gte: new Date(now.getTime() - 90 * DAY) } }, _sum: { ticketRevenueMinor: true, admissions: true } });
    const priceMinor = priceRow._sum.admissions ? Math.round((priceRow._sum.ticketRevenueMinor ?? 0) / priceRow._sum.admissions) : 1000;
    const shows: NightShow[] = rows.map((r) => ({ id: r.screening.id, filmId: r.screening.filmId, start: r.screening.startsAt.getTime(), capacity: r.forecast.capacity, demand: r.forecast.demand, priceMinor }));
    const find = (id: string) => {
      const r = rows.find((x) => x.screening.id === id);
      if (!r) throw Errors.notFound('Screening on this day');
      return r;
    };
    const seatsOf = async (auditoriumId: string) => {
      const a = await this.prisma.auditorium.findFirst({ where: { id: auditoriumId, tenantId: t.id, venueId: body.venueId }, include: { layouts: { where: { status: 'PUBLISHED' }, select: { seatCount: true }, take: 1 } } });
      if (!a) throw Errors.notFound('Screen');
      return { name: a.name, seats: a.layouts[0]?.seatCount ?? 0 };
    };
    let change: Change;
    let label: string;
    const c = body.change;
    if (c.kind === 'add') {
      const fc = ctx.films.get(c.filmId);
      if (!fc) throw Errors.notFound('Film');
      const screen = await seatsOf(c.auditoriumId);
      const startsAt = zonedToUtc(day, c.time, v.timeZone);
      const cal = showCalendar(startsAt, v.timeZone, divisionForPostcode(v.postcode), ctx.banks);
      const f = forecast(
        { screeningId: 'new', venueId: body.venueId, filmId: c.filmId, capacity: screen.seats, slot: cal.slot, dayOfWeek: cal.dow, filmWeek: filmWeekOf(fc.film.releaseDate, startsAt), formats: [], schoolHoliday: cal.schoolHoliday, soldNow: 0, timedSold: 0, hoursBefore: 24 * 365, venueName: v.name, filmTitle: fc.film.title },
        fc,
        ctx.model,
      );
      // A show that is not on sale yet has no pace to read, so it is forecast from the model alone.
      change = { kind: 'add', show: { id: 'new', filmId: c.filmId, start: startsAt.getTime(), capacity: screen.seats, demand: f.demand, priceMinor } };
      label = `Add ${fc.film.title} at ${c.time} in ${screen.name}`;
    } else if (c.kind === 'remove') {
      const r = find(c.screeningId);
      change = { kind: 'remove', showId: c.screeningId };
      label = `Cancel ${ctx.films.get(r.screening.filmId)?.film.title ?? 'the show'} at ${r.summary.localTime}`;
    } else if (c.kind === 'move') {
      const r = find(c.screeningId);
      const screen = await seatsOf(c.auditoriumId);
      change = { kind: 'move', showId: c.screeningId, capacity: screen.seats };
      label = `Move ${ctx.films.get(r.screening.filmId)?.film.title ?? 'the show'} at ${r.summary.localTime} to ${screen.name} (${screen.seats} seats)`;
    } else {
      const r = find(c.screeningId);
      change = { kind: 'price', showId: c.screeningId, percent: c.percent };
      label = `${c.percent > 0 ? 'Raise' : 'Cut'} prices ${Math.abs(c.percent)}% on ${ctx.films.get(r.screening.filmId)?.film.title ?? 'the show'} at ${r.summary.localTime}`;
    }
    const sim = simulate(shows, change, DEFAULT_CHOICE);
    const title = (id: string, filmId: string) => (id === 'new' ? `${ctx.films.get(filmId)?.film.title ?? 'New show'} (new)` : `${ctx.films.get(filmId)?.film.title ?? 'Film'} ${rows.find((x) => x.screening.id === id)?.summary.localTime ?? ''}`.trim());
    return {
      basis: this.basis(ctx.model),
      venue: { id: body.venueId, name: v.name },
      date: day,
      action: label,
      ...sim,
      shows: sim.shows.map((s) => ({ ...s, label: title(s.id, s.filmId) })).filter((s) => s.before !== s.after || s.id === 'new'),
      averageTicketMinor: priceMinor,
    };
  }

  async staffing(t: Tenant, venueId?: string, date?: string) {
    const { ctx, v, day, start, end, rows } = await this.venueDay(t, venueId, date);
    const shifts = await this.prisma.shift.findMany({ where: { tenantId: t.id, venueId: venueId!, startsAt: { lt: end }, endsAt: { gt: new Date(start.getTime() - 3 * 3_600_000) } } });
    const fmt = (d: Date) => {
      const p = localParts(d, v.timeZone);
      return `${pad(Math.floor(p.minutes / 60))}:${pad(p.minutes % 60)}`;
    };
    const windows = staffingPlan(rows.map((r) => ({ startsAt: r.screening.startsAt, expected: r.forecast.expected })), shifts, fmt);
    const gaps = windows.filter((w) => w.short);
    return {
      basis: this.basis(ctx.model),
      venue: { id: venueId, name: v.name },
      date: day,
      rota: { shifts: shifts.length, connected: shifts.length > 0 },
      expectedAdmissions: rows.reduce((a, r) => a + r.forecast.expected, 0),
      windows,
      gaps,
      summary: !rows.length ? 'No shows on this day.' : !shifts.length ? 'No rota connected for this day: showing what the forecast needs.' : gaps.length ? `${gaps.length} half-hour${gaps.length === 1 ? '' : 's'} short of what the forecast needs.` : 'Covered: the rota meets what the forecast needs.',
    };
  }

  private async mixFor(t: Tenant, venueId?: string): Promise<{ mix: MixItem[]; source: 'live' | 'demo' | 'none'; orders: number }> {
    const since = new Date(this.clock.now().getTime() - 60 * DAY);
    const lines = await this.prisma.bookingConcession.findMany({
      where: { booking: { tenantId: t.id, status: 'CONFIRMED', createdAt: { gte: since }, ...(venueId ? { screening: { venueId } } : {}) } },
      select: { productId: true, name: true, quantity: true, bookingId: true },
    });
    const orders = new Set(lines.map((l) => l.bookingId)).size;
    if (orders >= 30 || !DEMO_TENANTS.includes(t.slug)) return { mix: productMix(lines), source: orders ? 'live' : 'none', orders };
    const products = await this.prisma.concessionProduct.findMany({ where: { tenantId: t.id, available: true, ...(venueId ? { OR: [{ venueId: null }, { venueId }] } : {}) }, select: { id: true, name: true } });
    const baskets = demoBaskets(products.map((p) => p.name));
    const demoLines = baskets.flatMap((b, i) => b.map((name) => ({ productId: products.find((p) => p.name === name)!.id, name, quantity: 1, bookingId: `demo-${i}` })));
    return { mix: productMix(demoLines), source: 'demo', orders: baskets.length };
  }

  async food(t: Tenant, venueId?: string, date?: string) {
    const { ctx, v, day, rows } = await this.venueDay(t, venueId, date);
    const rates = attachRates(ctx.outcomes.filter((o) => o.venueId === venueId));
    const { mix, source, orders } = await this.mixFor(t, venueId);
    const shows = rows.map((r) => ({ ...r.summary, expected: r.forecast.expected, ...prepForShow(r.forecast.expected, r.summary.film.certificate, r.input.slot, rates, mix) }));
    const totals = new Map<string, { productId: string; name: string; quantity: number }>();
    for (const s of shows) for (const i of s.items) {
      const c = totals.get(i.productId) ?? { ...i, quantity: 0 };
      c.quantity += i.quantity;
      totals.set(i.productId, c);
    }
    return { basis: { ...this.basis(ctx.model), mix: source, mixOrders: orders }, venue: { id: venueId, name: v.name }, date: day, attachRates: rates, shows, totals: [...totals.values()].sort((a, b) => b.quantity - a.quantity) };
  }

  async baskets(t: Tenant) {
    const since = new Date(this.clock.now().getTime() - 180 * DAY);
    const lines = await this.prisma.bookingConcession.findMany({ where: { booking: { tenantId: t.id, status: 'CONFIRMED', createdAt: { gte: since } } }, select: { bookingId: true, name: true } });
    const byBooking = new Map<string, string[]>();
    for (const l of lines) byBooking.set(l.bookingId, [...(byBooking.get(l.bookingId) ?? []), l.name]);
    let orders = [...byBooking.values()];
    const live = orders.length;
    let demo = 0;
    if (live < 40 && DEMO_TENANTS.includes(t.slug)) {
      const menu = await this.prisma.concessionProduct.findMany({ where: { tenantId: t.id, available: true }, select: { name: true } });
      const extra = demoBaskets([...new Set(menu.map((m) => m.name))]);
      demo = extra.length;
      orders = [...orders, ...extra];
    }
    return { basis: { liveOrders: live, demoOrders: demo, note: demo ? `Based on ${live} real food orders and ${demo} demo orders.` : `Based on ${live} food orders in the last six months.` }, rules: basketRules(orders) };
  }

  async loyalty(t: Tenant) {
    const now = this.clock.now();
    const ctx = await this.context(t);
    const bookings = await this.prisma.booking.findMany({
      where: { tenantId: t.id, status: 'CONFIRMED', createdAt: { gte: new Date(now.getTime() - 500 * DAY) } },
      select: { customerId: true, totalMinor: true, screening: { select: { startsAt: true, filmId: true, venueId: true } } },
    });
    const byCustomer = new Map<string, CustomerHistory>();
    for (const b of bookings) {
      const v = ctx.venues.get(b.screening.venueId);
      const cert = ctx.films.get(b.screening.filmId)?.film.certificate ?? '';
      const minutes = v ? localParts(b.screening.startsAt, v.timeZone).minutes : 0;
      const h = byCustomer.get(b.customerId) ?? { customerId: b.customerId, visits: [] };
      h.visits.push({ at: b.screening.startsAt, spendMinor: b.totalMinor, familyMatinee: ['U', 'PG'].includes(cert) && minutes < 17 * 60 });
      byCustomer.set(b.customerId, h);
    }
    let customers = [...byCustomer.values()];
    const live = customers.length;
    let demo = 0;
    if (live < 30 && DEMO_TENANTS.includes(t.slug)) {
      const extra = demoCustomers(now);
      demo = extra.length;
      customers = [...customers, ...extra];
    }
    // BG/NBD needs enough repeat visitors to fit; until then the simple overdue rule applies.
    const repeaters = customers.filter((c) => c.visits.filter((v) => v.at.getTime() <= now.getTime()).length >= 2).length;
    let bg: BgParams | null = null;
    if (customers.length >= 50 && repeaters >= 20) {
      const key = `${t.id}:${customers.length}:${repeaters}`;
      const hit = this.bgCache.get(t.id);
      if (hit && hit.key === key && now.getTime() - hit.at < MODEL_TTL) bg = hit.params;
      else {
        const past = customers.map((c) => c.visits.map((v) => v.at).filter((d) => d.getTime() <= now.getTime())).filter((v) => v.length > 0);
        bg = fitBgNbd(past.map((v) => rfmFrom(v, now)));
        this.bgCache.set(t.id, { key, at: now.getTime(), params: bg });
      }
    }
    const scores = scoreCustomers(customers, now, bg);
    const atRisk = scores.filter((s) => s.segment === 'Lapsing');
    return {
      basis: { liveCustomers: live, demoCustomers: demo, note: demo ? `Based on ${live} real customers and ${demo} demo customers.` : `Based on ${live} customers who booked in the last 500 days.` },
      customers: scores.length,
      segments: segmentSummary(scores),
      atRisk: {
        customers: atRisk.length,
        share: scores.length ? Math.round((atRisk.length / scores.length) * 1000) / 1000 : 0,
        note: bg ? 'Repeat visitors who are now more likely than not to have stopped coming, given how often they used to visit.' : 'Overdue by at least twice their usual gap between visits, but seen in the last six months.',
      },
      model: bg ? { kind: 'BG/NBD', params: bg, expectedVisitsNext13Weeks: Math.round(scores.reduce((a, s) => a + (s.expectedVisits90 ?? 0), 0)) } : { kind: 'rule', params: null, expectedVisitsNext13Weeks: null },
    };
  }

  async anomalies(t: Tenant) {
    const ctx = await this.context(t);
    const now = this.clock.now();
    const since = now.getTime() - 14 * DAY;
    const recent = ctx.outcomes.filter((o) => o.startsAt.getTime() >= since);
    const useLive = recent.some((o) => o.source === 'live');
    const days = new Map<string, { venueId: string; venueName: string; date: string; actual: number; forecast: number }>();
    for (const o of recent.filter((r) => (useLive ? r.source === 'live' : true))) {
      const v = ctx.venues.get(o.venueId);
      if (!v) continue;
      const date = localParts(o.startsAt, v.timeZone).ymd;
      const k = `${o.venueId}:${date}`;
      const d = days.get(k) ?? { venueId: o.venueId, venueName: v.name, date, actual: 0, forecast: 0 };
      d.actual += o.admissions;
      d.forecast += expectedFromModel(o, ctx.films.get(o.filmId), ctx.model);
      days.set(k, d);
    }
    const list = [...days.values()].map((d) => ({ ...d, forecast: Math.round(d.forecast) }));
    return { basis: this.basis(ctx.model), days: list.length, anomalies: anomalies(list) };
  }

  /**
   * The Pulse brief: the week's best moves for the AI layer, each with a simulated impact,
   * a confidence and a link to act. Deterministic; the AI layer narrates it, never invents it.
   * Items without a measured money impact (staffing gaps, members drifting away, films that
   * deserve more shows) carry impactMinor null and are left out of the total.
   */
  async brief(t: Tenant) {
    const ctx = await this.context(t);
    const now = this.clock.now();
    const rows = await this.upcoming(t, ctx, now, new Date(now.getTime() + 7 * DAY));
    const { perHead } = await this.nights(t, rows);
    const conf = (c: PulseForecast['confidence']) => (c === 'high' ? 85 : c === 'medium' ? 65 : 40);
    const day = (ymd: string) => new Intl.DateTimeFormat('en-GB', { weekday: 'long', timeZone: 'UTC' }).format(new Date(`${ymd}T12:00:00Z`));
    type Item = { id: string; kind: string; title: string; detail: string; impactMinor: number | null; admissions: number | null; confidence: number; action: { label: string; href: string }; evidence: Record<string, unknown> };
    const items: Item[] = [];

    // Prices: only ideas the night's choice model says pay, tickets and food together.
    for (const p of (await this.pricing(t)).suggestions) {
      const r = rows.find((x) => x.screening.id === p.screeningId);
      items.push({
        id: `price:${p.screeningId}`,
        kind: 'Pricing',
        title: `${p.action === 'raise' ? `Raise ${p.film.title} by ${p.percent}%` : `Try ${p.percent}% off ${p.film.title}`} on ${day(p.localDate)} at ${p.localTime}`,
        detail: `${p.reasons[0]} Pulse expects ${p.impact.admissions >= 0 ? `${p.impact.admissions} more` : `${-p.impact.admissions} fewer`} admissions that night at ${p.venue.name}, with food included.`,
        impactMinor: p.impact.totalMinor,
        admissions: p.impact.admissions,
        confidence: r ? conf(r.forecast.confidence) : 50,
        action: { label: 'Review price', href: '/seating' },
        evidence: { screeningId: p.screeningId, simulate: { venueId: p.venue.id, date: p.localDate, change: { kind: 'price', screeningId: p.screeningId, percent: p.action === 'raise' ? p.percent : -p.percent } } },
      });
    }
    // Screen swaps from the next three days.
    for (const s of (await this.screens(t)).swaps) {
      const ph = perHead(s.venue.id);
      items.push({
        id: `swap:${s.from.screeningId}`,
        kind: 'Screens',
        title: `Swap ${s.from.filmTitle} and ${s.to.filmTitle} on ${day(s.localDate)} at ${s.localTime}`,
        detail: `${s.reason} At ${s.venue.name}.`,
        impactMinor: s.extraAdmissions * (ph.ticket + ph.food),
        admissions: s.extraAdmissions,
        confidence: 70,
        action: { label: 'Open screens', href: '/layouts' },
        evidence: { from: s.from, to: s.to },
      });
    }
    // Films with strong audience interest but a thin programme.
    const showsByFilm = new Map<string, number>();
    for (const r of rows) showsByFilm.set(r.screening.filmId, (showsByFilm.get(r.screening.filmId) ?? 0) + 1);
    const avgShows = showsByFilm.size ? [...showsByFilm.values()].reduce((a, x) => a + x, 0) / showsByFilm.size : 0;
    for (const [filmId, n] of showsByFilm) {
      const fc = ctx.films.get(filmId);
      if (!fc?.interest || fc.interest.strength < 1.4 || n > avgShows * 0.75) continue;
      items.push({
        id: `interest:${filmId}`,
        kind: 'Programme',
        title: `Give ${fc.film.title} more shows next week`,
        detail: `Its audience interest is ${(fc.interest.views / fc.interest.typical).toFixed(1)} times the typical film you show, but it has ${n} shows in the next 7 days against an average of ${Math.round(avgShows)}.${fc.interest.source === 'demo' ? ' (Demo figures.)' : ''}`,
        impactMinor: null,
        admissions: null,
        confidence: fc.interest.source === 'demo' ? 50 : 60,
        action: { label: 'Plan shows', href: '/next-weeks' },
        evidence: { filmId, shows: n, averageShows: avgShows, interest: fc.interest },
      });
    }
    // Film runs: what next week's programme should do with each film.
    for (const f of (await this.filmRuns(t)).films) {
      if (f.verdict === 'hold' || f.showsNext7Days === 0) continue;
      items.push({
        id: `run:${f.filmId}`,
        kind: 'Programme',
        title: f.verdict === 'grow' ? `Give ${f.title} more shows in week ${f.nextWeek}` : f.verdict === 'trim' ? `Trim ${f.title} in week ${f.nextWeek}` : `Consider ending ${f.title}'s run`,
        detail: f.reason,
        impactMinor: null,
        admissions: null,
        confidence: Math.round(50 + 35 * f.dataWeight),
        action: { label: 'Plan shows', href: '/next-weeks' },
        evidence: { filmId: f.filmId, retention: f.retention, priorRetention: f.priorRetention, projectedPull: f.projectedPull, weeks: f.weeks },
      });
    }
    // Staffing gaps today and tomorrow.
    for (const venueId of ctx.venues.keys()) {
      for (const offset of [0, 1]) {
        const date = localParts(new Date(now.getTime() + offset * DAY), ctx.venues.get(venueId)!.timeZone).ymd;
        const st = await this.staffing(t, venueId, date);
        if (!st.rota.connected || !st.gaps.length) continue;
        items.push({
          id: `staff:${venueId}:${date}`,
          kind: 'Staffing',
          title: `${st.gaps.length} half-hour${st.gaps.length === 1 ? '' : 's'} short at ${st.venue.name} ${offset === 0 ? 'today' : 'tomorrow'}`,
          detail: `From ${st.gaps[0].from}, the forecast needs more on tills or doors than the rota has. ${st.expectedAdmissions} people expected.`,
          impactMinor: null,
          admissions: null,
          confidence: 70,
          action: { label: 'Open today', href: '/today' },
          evidence: { venueId, date, gaps: st.gaps },
        });
      }
    }
    // Members drifting away.
    const loyalty = await this.loyalty(t);
    if (loyalty.atRisk.customers > 0) {
      items.push({
        id: 'members:at-risk',
        kind: 'Members',
        title: `Win back ${loyalty.atRisk.customers} customers drifting away`,
        detail: `${loyalty.atRisk.note}`,
        impactMinor: null,
        admissions: null,
        confidence: loyalty.basis.demoCustomers ? 50 : 70,
        action: { label: 'Open loyalty', href: '/loyalty' },
        evidence: { atRisk: loyalty.atRisk },
      });
    }
    const order = (i: Item) => (i.impactMinor ?? -1);
    const ranked = items.sort((a, b) => order(b) - order(a));
    const top = [...ranked.filter((i) => i.impactMinor !== null).slice(0, 4), ...ranked.filter((i) => i.impactMinor === null).slice(0, 3)];
    return {
      basis: this.basis(ctx.model),
      generatedAt: now.toISOString(),
      horizonDays: 7,
      totalImpactMinor: top.reduce((a, i) => a + (i.impactMinor ?? 0), 0),
      items: top,
    };
  }

  /**
   * Film runs: for each film that played in the last fortnight, how fast its audience is falling
   * away here (fitted against its genre prior) and what that means for next week's shows.
   */
  async filmRuns(t: Tenant) {
    const ctx = await this.context(t);
    const now = this.clock.now();
    const recent = new Set(ctx.outcomes.filter((o) => o.startsAt.getTime() >= now.getTime() - 14 * DAY).map((o) => o.filmId));
    const upcoming = await this.prisma.screening.groupBy({ by: ['filmId'], where: { tenantId: t.id, status: 'SCHEDULED', startsAt: { gte: now, lt: new Date(now.getTime() + 7 * DAY) } }, _count: { _all: true } });
    const runs: (FilmRun & { showsNext7Days: number })[] = [];
    for (const filmId of recent) {
      const fc = ctx.films.get(filmId);
      if (!fc || fc.hidden) continue;
      const rows = weeklyRows(ctx.outcomes.filter((o) => o.filmId === filmId));
      if (!rows.length) continue;
      const nowWeek = filmWeekOf(fc.film.releaseDate, now);
      runs.push({ ...filmRun(fc.film, rows, nowWeek), showsNext7Days: upcoming.find((u) => u.filmId === filmId)?._count._all ?? 0 });
    }
    const order = { grow: 0, trim: 1, end: 2, hold: 3 } as const;
    return { basis: this.basis(ctx.model), films: runs.sort((a, b) => order[a.verdict] - order[b.verdict] || b.projectedPull - a.projectedPull) };
  }

  /** Cinemas and their screens, for Ask Pulse to turn names into ids. */
  async venuesForAsk(t: Tenant) {
    const ctx = await this.context(t);
    const screens = await this.prisma.auditorium.findMany({ where: { tenantId: t.id }, select: { id: true, name: true, venueId: true, layouts: { where: { status: 'PUBLISHED' }, select: { seatCount: true }, take: 1 } } });
    return [...ctx.venues.entries()].map(([id, v]) => ({ id, name: v.name, screens: screens.filter((a) => a.venueId === id).map((a) => ({ id: a.id, name: a.name, seats: a.layouts[0]?.seatCount ?? 0 })) }));
  }

  /** How accurate Pulse would have been over recent weeks it had not seen, against two baselines. */
  async accuracy(t: Tenant) {
    const ctx = await this.context(t);
    ctx.accuracy ??= backtest(ctx.outcomes, ctx.films);
    return { basis: this.basis(ctx.model), ...ctx.accuracy };
  }

  async model(t: Tenant) {
    const ctx = await this.context(t);
    const label = (dim: string, k: string) =>
      dim === 'venue' ? ctx.venues.get(k)?.name ?? k : dim === 'film' ? ctx.films.get(k)?.film.title ?? k : dim === 'slot' ? SLOT_LABELS[k as Slot] ?? k : dim === 'dayOfWeek' ? DAY_NAMES[Number(k)] : `Release week ${k}`;
    return {
      basis: this.basis(ctx.model),
      priors: { slotBase: SLOT_BASE, targetWeeklyOccupancy: TARGET_WEEKLY_OCCUPANCY, shrinkageK: SHRINKAGE_K },
      multipliers: Object.fromEntries(DIMENSIONS.map((d) => [d, Object.entries(ctx.model.multipliers[d]).map(([k, c]) => ({ key: k, label: label(d, k), multiplier: c.m, shows: c.shows })).sort((a, b) => b.multiplier - a.multiplier)])),
      curves: { hoursBefore: LEAD_BUCKETS, bySlot: Object.entries(ctx.model.curves).map(([slot, values]) => ({ slot, label: SLOT_LABELS[slot as Slot], values, shows: ctx.model.curveShows[slot as Slot] })) },
      // Audience interest for films showing now or soon, strongest first.
      interest: [...ctx.films.values()]
        .filter((f) => !f.hidden && f.interest)
        .map((f) => ({ filmId: f.film.id, title: f.film.title, views: f.interest!.views, typical: f.interest!.typical, strength: f.interest!.strength, source: f.interest!.source, series: !!f.film.series }))
        .sort((a, b) => b.views - a.views),
    };
  }

  // -------------------------------------------------------------------------
  // Customer-facing
  // -------------------------------------------------------------------------

  private async recContext(t: Tenant) {
    const ctx = await this.context(t);
    const now = this.clock.now();
    const [upcoming, bookings] = await Promise.all([
      this.prisma.screening.findMany({ where: { tenantId: t.id, status: 'SCHEDULED', startsAt: { gte: now, lt: new Date(now.getTime() + 21 * DAY) } }, select: { id: true, filmId: true } }),
      this.prisma.booking.findMany({ where: { tenantId: t.id, status: 'CONFIRMED', createdAt: { gte: new Date(now.getTime() - 365 * DAY) } }, select: { customerId: true, screening: { select: { filmId: true } } } }),
    ]);
    const sold = upcoming.length ? await this.prisma.screeningSeat.groupBy({ by: ['screeningId'], where: { screeningId: { in: upcoming.map((u) => u.id) }, state: 'SOLD' }, _count: { _all: true } }) : [];
    const popularity = new Map<string, number>();
    for (const s of sold) {
      const filmId = upcoming.find((u) => u.id === s.screeningId)!.filmId;
      popularity.set(filmId, (popularity.get(filmId) ?? 0) + s._count._all);
    }
    const showing = new Set(upcoming.map((u) => u.filmId));
    const candidates: RecFilm[] = [...ctx.films.values()]
      .filter((f) => !f.hidden && (showing.has(f.film.id) || (f.film.releaseDate.getTime() > now.getTime() && f.film.releaseDate.getTime() < now.getTime() + 60 * DAY)))
      .map((f) => ({ id: f.film.id, title: f.film.title, genres: f.film.genres, certificate: f.film.certificate }));
    const aud = audiences(bookings.map((b) => ({ customerId: b.customerId, filmId: b.screening.filmId })));
    return { ctx, candidates, aud, popularity, bookings };
  }

  private filmOut(ctx: Ctx, id: string) {
    const f = ctx.films.get(id)!;
    return { id, slug: f.slug, title: f.film.title, certificate: f.film.certificate, genres: f.film.genres, posterUrl: f.posterUrl };
  }

  async recommendations(t: Tenant, customerId: string) {
    const { ctx, candidates, aud, popularity, bookings } = await this.recContext(t);
    const seenIds = [...new Set(bookings.filter((b) => b.customerId === customerId).map((b) => b.screening.filmId))];
    const seen = seenIds.map((id) => ctx.films.get(id)).filter((f): f is NonNullable<typeof f> => !!f).map((f) => ({ id: f.film.id, title: f.film.title, genres: f.film.genres, certificate: f.film.certificate }));
    const recs = recommend(seen, candidates, aud, popularity);
    return { basis: { bookingsUsed: bookings.length, personal: seen.length > 0 }, recommendations: recs.map((r) => ({ film: this.filmOut(ctx, r.film.id), score: r.score, reason: r.reason })) };
  }

  async alsoBooked(t: Tenant, filmId: string) {
    const { ctx, candidates, aud, bookings } = await this.recContext(t);
    const f = ctx.films.get(filmId) ?? [...ctx.films.values()].find((x) => x.slug === filmId);
    if (!f || f.hidden) throw Errors.notFound('Film');
    const list = alsoBooked({ id: f.film.id, title: f.film.title, genres: f.film.genres, certificate: f.film.certificate }, candidates, aud);
    return { basis: { bookingsUsed: bookings.length }, films: list.map((r) => ({ film: this.filmOut(ctx, r.film.id), score: r.score, reason: r.reason })) };
  }
}

const pad = (n: number) => String(n).padStart(2, '0');
const numberOrNull = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
function parseDate(s?: string): Date | null {
  if (!s) return null;
  const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? `${s}T00:00:00Z` : s);
  return Number.isNaN(d.getTime()) ? null : d;
}
