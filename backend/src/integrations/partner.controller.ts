import { Body, Controller, Delete, Get, HttpCode, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Tenant } from '@prisma/client';
import { z } from 'zod';
import { filmDto } from '../catalogue/film-dto';
import { Clock } from '../common/clock';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { CurrentTenant } from '../common/tenant-context';
import { ZodPipe } from '../common/zod.pipe';
import { venueDto } from '../venues/venues.module';
import { PartnerGuard, RequireScope } from './partner.guard';
import { partnerBooking, partnerBookingInclude } from './partner-dto';
import { WebhookService } from './webhooks.service';

const iso = z.string().datetime({ offset: true });
const shiftsBody = z.object({
  /** The rota system, e.g. "planday", "deputy" or "rotacloud". Shifts are matched on (source, externalId). */
  source: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9_-]{1,31}$/),
  shifts: z
    .array(
      z.object({
        externalId: z.string().trim().min(1).max(100),
        venueId: z.string().min(1),
        staffName: z.string().trim().min(1).max(80),
        staffEmail: z.string().trim().email().max(200).nullable().optional(),
        role: z.string().trim().min(1).max(60),
        startsAt: iso,
        endsAt: iso,
        note: z.string().trim().max(300).nullable().optional(),
      }),
    )
    .max(500),
});

/** Parses a from/to window; default from now for `days` days; never more than 92 days. */
function window(now: Date, from?: string, to?: string, days = 7) {
  const start = from ? new Date(from) : now;
  const end = to ? new Date(to) : new Date(start.getTime() + days * 86400_000);
  if (isNaN(start.getTime()) || isNaN(end.getTime()) || end <= start) throw Errors.validation('from and to must be ISO dates with from before to');
  if (end.getTime() - start.getTime() > 92 * 86400_000) throw Errors.validation('Ask for 92 days or fewer at a time');
  return { start, end };
}

/**
 * The partner API: what other systems (rota tools, BI and data warehouses, listing
 * sites) may read or write, limited by the scopes on their key. Read-only unless a
 * write scope was granted; no customer contact details or payment data are exposed.
 */
@ApiTags('Partner')
@ApiBearerAuth()
@Controller('v1/partner')
@UseGuards(PartnerGuard)
export class PartnerController {
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock, private readonly webhooks: WebhookService) {}

  @Get('films')
  @RequireScope('films:read')
  async films(@CurrentTenant() t: Tenant) {
    const now = this.clock.now();
    const rows = await this.prisma.film.findMany({ where: { tenantId: t.id, hidden: false }, include: { assets: true }, orderBy: { releaseDate: 'desc' } });
    return rows.map((f) => filmDto(f, now));
  }

  @Get('venues')
  @RequireScope('venues:read')
  async venues(@CurrentTenant() t: Tenant) {
    const rows = await this.prisma.venue.findMany({ where: { tenantId: t.id }, include: { auditoriums: { select: { id: true, name: true, screenNumber: true } } }, orderBy: { name: 'asc' } });
    return rows.map((v) => ({ ...venueDto(v), screens: v.auditoriums.map((a) => ({ id: a.id, name: a.name, number: a.screenNumber })) }));
  }

  @Get('screenings')
  @RequireScope('screenings:read')
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false }) @ApiQuery({ name: 'venueId', required: false })
  async screenings(@CurrentTenant() t: Tenant, @Query('from') from?: string, @Query('to') to?: string, @Query('venueId') venueId?: string) {
    const { start, end } = window(this.clock.now(), from, to);
    const rows = await this.prisma.screening.findMany({
      where: { tenantId: t.id, startsAt: { gte: start, lt: end }, status: 'SCHEDULED', ...(venueId ? { venueId } : {}) },
      include: { film: { select: { id: true, title: true, certificate: true } }, venue: { select: { id: true, name: true } }, auditorium: { select: { name: true } } },
      orderBy: { startsAt: 'asc' },
      take: 2000,
    });
    const seats = await this.prisma.screeningSeat.groupBy({ by: ['screeningId', 'state'], where: { screeningId: { in: rows.map((r) => r.id) } }, _count: { _all: true } });
    const n = (id: string, s: string) => seats.find((x) => x.screeningId === id && x.state === s)?._count._all ?? 0;
    return rows.map((s) => ({
      id: s.id, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), venue: s.venue, screen: s.auditorium.name, film: s.film, formats: s.formats,
      capacity: n(s.id, 'SOLD') + n(s.id, 'HELD') + n(s.id, 'AVAILABLE'), sold: n(s.id, 'SOLD'),
    }));
  }

  /** Sales by confirmation time, oldest first, up to 500 a page; pass `after` (a booking id) for the next page. */
  @Get('bookings')
  @RequireScope('bookings:read')
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false }) @ApiQuery({ name: 'venueId', required: false }) @ApiQuery({ name: 'after', required: false })
  async bookings(@CurrentTenant() t: Tenant, @Query('from') from?: string, @Query('to') to?: string, @Query('venueId') venueId?: string, @Query('after') after?: string) {
    const now = this.clock.now();
    const { start, end } = window(from ? now : new Date(now.getTime() - 7 * 86400_000), from, to ?? (from ? undefined : now.toISOString()));
    const rows = await this.prisma.booking.findMany({
      where: { tenantId: t.id, status: { in: ['CONFIRMED', 'REFUNDED'] }, confirmedAt: { gte: start, lt: end }, ...(venueId ? { screening: { venueId } } : {}) },
      include: partnerBookingInclude,
      orderBy: [{ confirmedAt: 'asc' }, { id: 'asc' }],
      take: 501,
      ...(after ? { cursor: { id: after }, skip: 1 } : {}),
    });
    const page = rows.slice(0, 500);
    return { bookings: page.map(partnerBooking), next: rows.length > 500 ? page[page.length - 1].id : null };
  }

  @Get('shifts')
  @RequireScope('shifts:read')
  @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false }) @ApiQuery({ name: 'venueId', required: false })
  async shifts(@CurrentTenant() t: Tenant, @Query('from') from?: string, @Query('to') to?: string, @Query('venueId') venueId?: string) {
    const { start, end } = window(this.clock.now(), from, to, 14);
    const rows = await this.prisma.shift.findMany({ where: { tenantId: t.id, startsAt: { gte: start, lt: end }, ...(venueId ? { venueId } : {}) }, orderBy: { startsAt: 'asc' } });
    return rows.map(shiftDto);
  }

  /** Adds or updates shifts, matched on (source, externalId). Re-sending the same rota is safe. */
  @Put('shifts')
  @RequireScope('shifts:write')
  async putShifts(@CurrentTenant() t: Tenant, @Body(new ZodPipe(shiftsBody)) b: z.infer<typeof shiftsBody>) {
    const venueIds = new Set((await this.prisma.venue.findMany({ where: { tenantId: t.id }, select: { id: true } })).map((v) => v.id));
    const bad = b.shifts.filter((s) => !venueIds.has(s.venueId)).map((s) => s.externalId);
    if (bad.length) throw Errors.validation('Some shifts are for a cinema that is not yours', { externalIds: bad.slice(0, 20) });
    const wrongWay = b.shifts.filter((s) => new Date(s.endsAt) <= new Date(s.startsAt)).map((s) => s.externalId);
    if (wrongWay.length) throw Errors.validation('A shift must end after it starts', { externalIds: wrongWay.slice(0, 20) });
    await this.prisma.$transaction(
      b.shifts.map((s) => {
        const data = { venueId: s.venueId, staffName: s.staffName, staffEmail: s.staffEmail ?? null, role: s.role, startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt), note: s.note ?? null };
        return this.prisma.shift.upsert({
          where: { tenantId_source_externalId: { tenantId: t.id, source: b.source, externalId: s.externalId } },
          create: { ...data, tenantId: t.id, source: b.source, externalId: s.externalId },
          update: data,
        });
      }),
    );
    if (b.shifts.length) await this.webhooks.emit(t.id, 'shifts.updated', { source: b.source, upserted: b.shifts.map((s) => s.externalId), removed: [] });
    return { source: b.source, upserted: b.shifts.length };
  }

  @Delete('shifts/:source/:externalId')
  @HttpCode(204)
  @RequireScope('shifts:write')
  async deleteShift(@CurrentTenant() t: Tenant, @Param('source') source: string, @Param('externalId') externalId: string) {
    const { count } = await this.prisma.shift.deleteMany({ where: { tenantId: t.id, source: source.toLowerCase(), externalId } });
    if (!count) throw Errors.notFound('Shift');
    await this.webhooks.emit(t.id, 'shifts.updated', { source: source.toLowerCase(), upserted: [], removed: [externalId] });
  }
}

export function shiftDto(s: { id: string; venueId: string; source: string; externalId: string; staffName: string; staffEmail: string | null; role: string; startsAt: Date; endsAt: Date; note: string | null }) {
  return { id: s.id, venueId: s.venueId, source: s.source, externalId: s.externalId, staffName: s.staffName, staffEmail: s.staffEmail, role: s.role, startsAt: s.startsAt.toISOString(), endsAt: s.endsAt.toISOString(), note: s.note };
}
