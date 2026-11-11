import { Injectable } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { imageRef, pickAsset } from '../catalogue/film-dto';
import { Clock } from '../common/clock';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { zonedDayBounds } from '../common/time';
import { anomalies } from './anomalies';
import { basketRules } from './baskets';
import { BankHolidaySet, DAY_NAMES, divisionForPostcode, localParts, Slot, SLOT_LABELS, showCalendar } from './calendar';
import { demoBaskets, demoCustomers } from './demo';
import { interestStrength, median } from './interest';
import { backtest, BacktestResult, calibrateRanges } from './backtest';
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
        ? `Based on ${model.liveShows} live shows and ${model.demoShows} demo shows over ${weeks} weeks.`
        : model.demoShows
          ? `Based on ${weeks} weeks of demo history (${model.demoShows} shows).`
          : `Based on ${weeks} weeks of your sales (${model.liveShows} shows).`;
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

  async pricing(t: Tenant) {
    const ctx = await this.context(t);
    const now = this.clock.now();
    const rows = await this.upcoming(t, ctx, now, new Date(now.getTime() + 7 * DAY));
    const suggestions = rows.flatMap((r) => {
      const s = priceSuggestion(r.forecast, r.input.hoursBefore);
      return s ? [{ ...r.summary, ...s, forecast: { expected: r.forecast.expected, capacity: r.forecast.capacity, occupancy: r.forecast.occupancy, paceIndex: r.forecast.paceIndex } }] : [];
    });
    return { basis: this.basis(ctx.model), caps: PRICE_CAPS, suggestions };
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
    const scores = scoreCustomers(customers, now);
    const atRisk = scores.filter((s) => (s.churnRisk ?? 0) >= 2 && s.daysSinceLast < 180);
    return {
      basis: { liveCustomers: live, demoCustomers: demo, note: demo ? `Based on ${live} real customers and ${demo} demo customers.` : `Based on ${live} customers who booked in the last 500 days.` },
      customers: scores.length,
      segments: segmentSummary(scores),
      atRisk: { customers: atRisk.length, share: scores.length ? Math.round((atRisk.length / scores.length) * 1000) / 1000 : 0, note: 'Overdue by at least twice their usual gap between visits, but seen in the last six months.' },
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
