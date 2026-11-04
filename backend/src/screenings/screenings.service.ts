import { Injectable } from '@nestjs/common';
import { Prisma, Tenant } from '@prisma/client';
import { AuditoriumLayout } from '@cinema/contracts';
import { imageRef, pickAsset } from '../catalogue/film-dto';
import { Clock } from '../common/clock';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { zonedDate, zonedDayBounds } from '../common/time';
import { PricingService } from '../pricing/pricing.service';

const listInclude = {
  film: { include: { assets: true } },
  venue: true,
  auditorium: true,
  layoutVersion: { select: { seatCount: true } },
} satisfies Prisma.ScreeningInclude;
type ScreeningRow = Prisma.ScreeningGetPayload<{ include: typeof listInclude }>;

export type SeatStateDto = 'available' | 'held' | 'sold' | 'blocked';

@Injectable()
export class ScreeningsService {
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock, private readonly pricing: PricingService) {}

  private async availableCounts(ids: string[]): Promise<Map<string, number>> {
    if (!ids.length) return new Map();
    const now = this.clock.now();
    const rows = await this.prisma.$queryRaw<{ screeningId: string; n: bigint }[]>`
      SELECT "screeningId", COUNT(*) AS n FROM "ScreeningSeat"
      WHERE "screeningId" = ANY(${ids})
        AND ("state" = 'AVAILABLE' OR ("state" = 'HELD' AND "heldUntil" <= ${now}))
      GROUP BY "screeningId"`;
    return new Map(rows.map((r) => [r.screeningId, Number(r.n)]));
  }

  private summary(s: ScreeningRow, available: number) {
    const total = s.layoutVersion.seatCount;
    const ratio = total ? available / total : 0;
    const onSale = s.status === 'SCHEDULED' && s.startsAt > this.clock.now() && available > 0;
    return {
      id: s.id,
      startsAt: s.startsAt.toISOString(),
      endsAt: s.endsAt.toISOString(),
      localDate: zonedDate(s.startsAt, s.venue.timeZone),
      formats: s.formats,
      attributes: s.attributes,
      onSale,
      availability: { available, total, level: available === 0 ? 'soldOut' : ratio < 0.2 ? 'limited' : 'good' },
      film: { id: s.film.id, title: s.film.title, certificate: s.film.certificate, runtimeMinutes: s.film.runtimeMinutes, poster: imageRef(pickAsset(s.film.assets, 'POSTER', this.clock.now())) },
      venue: { id: s.venue.id, name: s.venue.name, timeZone: s.venue.timeZone },
      auditorium: { id: s.auditorium.id, name: s.auditorium.name, screenNumber: s.auditorium.screenNumber },
    };
  }

  async list(tenantId: string, opts: { venueId?: string; filmId?: string; date?: string; days?: number }) {
    const now = this.clock.now();
    let range: { gte: Date; lt?: Date } = { gte: now };
    if (opts.date) {
      const tz = opts.venueId ? (await this.prisma.venue.findFirst({ where: { id: opts.venueId, tenantId } }))?.timeZone ?? 'Europe/London' : 'Europe/London';
      const { start, end } = zonedDayBounds(opts.date, tz);
      range = { gte: start > now ? start : now, lt: end };
    } else if (opts.days) {
      range = { gte: now, lt: new Date(now.getTime() + opts.days * 86400_000) };
    }
    const rows = await this.prisma.screening.findMany({
      where: { tenantId, status: 'SCHEDULED', startsAt: range, ...(opts.venueId ? { venueId: opts.venueId } : {}), ...(opts.filmId ? { filmId: opts.filmId } : {}) },
      include: listInclude,
      orderBy: { startsAt: 'asc' },
      take: 500,
    });
    const counts = await this.availableCounts(rows.map((r) => r.id));
    return rows.map((r) => this.summary(r, counts.get(r.id) ?? 0));
  }

  /** Dates (in venue local time) that have screenings, for the date strip. */
  async dates(tenantId: string, venueId: string, filmId?: string) {
    const venue = await this.prisma.venue.findFirst({ where: { id: venueId, tenantId } });
    if (!venue) throw Errors.notFound('Cinema');
    const rows = await this.prisma.screening.findMany({
      where: { tenantId, venueId, status: 'SCHEDULED', startsAt: { gte: this.clock.now() }, ...(filmId ? { filmId } : {}) },
      select: { startsAt: true },
      orderBy: { startsAt: 'asc' },
    });
    return [...new Set(rows.map((r) => zonedDate(r.startsAt, venue.timeZone)))];
  }

  async detail(tenant: Tenant, screeningId: string) {
    const s = await this.prisma.screening.findFirst({
      where: { id: screeningId, tenantId: tenant.id },
      include: { ...listInclude, layoutVersion: true },
    });
    if (!s) throw Errors.notFound('Screening');
    const counts = await this.availableCounts([s.id]);
    const layout = s.layoutVersion.geometry as unknown as AuditoriumLayout;
    return {
      ...this.summary(s as unknown as ScreeningRow, counts.get(s.id) ?? 0),
      layoutVersion: { id: s.layoutVersion.id, version: s.layoutVersion.version },
      layout,
      pricing: await this.pricing.ticketTypesFor(tenant, s, layout),
    };
  }

  async availability(tenantId: string, screeningId: string, customerId?: string) {
    const s = await this.prisma.screening.findFirst({ where: { id: screeningId, tenantId }, select: { id: true } });
    if (!s) throw Errors.notFound('Screening');
    const now = this.clock.now();
    const [rows, ownHold] = await Promise.all([
      this.prisma.screeningSeat.findMany({ where: { screeningId }, select: { seatId: true, state: true, holdId: true, heldUntil: true, version: true } }),
      customerId ? this.prisma.seatHold.findFirst({ where: { screeningId, customerId, status: 'ACTIVE', expiresAt: { gt: now } } }) : null,
    ]);
    const seats: Record<string, SeatStateDto> = {};
    let version = 0;
    for (const r of rows) {
      version += r.version;
      const expired = r.state === 'HELD' && r.heldUntil !== null && r.heldUntil <= now;
      seats[r.seatId] = expired ? 'available' : (r.state.toLowerCase() as SeatStateDto);
    }
    return {
      screeningId,
      serverTime: now.toISOString(),
      version,
      seats,
      yourHold: ownHold ? { id: ownHold.id, seatIds: ownHold.seatIds, expiresAt: ownHold.expiresAt.toISOString() } : null,
    };
  }
}
