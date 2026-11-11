import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AdminRole, Prisma, Tenant } from '@prisma/client';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { imageRef, pickAsset } from '../catalogue/film-dto';
import { Clock } from '../common/clock';
import { AuditService } from '../common/common.module';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { AdminGuard, CurrentAdmin, CurrentTenant, Roles } from '../common/tenant-context';
import { zonedDate, zonedDayBounds } from '../common/time';
import { AdminClaims, hashPassword } from '../common/tokens';
import { ZodPipe } from '../common/zod.pipe';

/** Roles an operator can give its own people (platform administrators are ours, not theirs). */
const OPERATOR_ROLES = ['OPERATOR_ADMIN', 'VENUE_MANAGER', 'CONTENT_EDITOR', 'REPORTING'] as const;
const memberBody = z.object({ name: z.string().trim().min(1).max(80), email: z.string().trim().email().max(200), role: z.enum(OPERATOR_ROLES) });
const roleBody = z.object({ role: z.enum(OPERATOR_ROLES) });

/** A readable temporary password, shown once to whoever adds the person. */
function temporaryPassword() {
  return randomBytes(9).toString('base64url');
}

/**
 * Day-to-day operations: what's on at a cinema today, and who can use the portal.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('v1/admin/t/:tenant')
@UseGuards(AdminGuard)
export class AdminOpsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly clock: Clock) {}

  /**
   * Every screening at one cinema on a day (default today, in the cinema's time zone):
   * film, screen, start, seats sold and held against capacity, and how many bookings
   * include food to prepare.
   */
  @Get('venues/:venueId/today')
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD in the cinema time zone' })
  async today(@CurrentTenant() t: Tenant, @Param('venueId') venueId: string, @Query('date') date?: string) {
    const venue = await this.prisma.venue.findFirst({ where: { id: venueId, tenantId: t.id } });
    if (!venue) throw Errors.notFound('Cinema');
    const now = this.clock.now();
    const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : zonedDate(now, venue.timeZone);
    const { start, end } = zonedDayBounds(day, venue.timeZone);
    const screenings = await this.prisma.screening.findMany({
      where: { tenantId: t.id, venueId, startsAt: { gte: start, lt: end }, status: 'SCHEDULED' },
      include: { auditorium: { select: { name: true } }, film: { include: { assets: true } } },
      orderBy: [{ startsAt: 'asc' }, { auditorium: { name: 'asc' } }],
    });
    const ids = screenings.map((s) => s.id);
    const [seats, food] = await Promise.all([
      this.prisma.screeningSeat.groupBy({ by: ['screeningId', 'state'], where: { screeningId: { in: ids } }, _count: { _all: true } }),
      this.prisma.booking.groupBy({ by: ['screeningId'], where: { screeningId: { in: ids }, status: 'CONFIRMED', concessionsMinor: { gt: 0 } }, _count: { _all: true } }),
    ]);
    const count = (id: string, state: string) => seats.find((r) => r.screeningId === id && r.state === state)?._count._all ?? 0;
    const shows = screenings.map((s) => {
      const sold = count(s.id, 'SOLD');
      const held = count(s.id, 'HELD');
      const capacity = sold + held + count(s.id, 'AVAILABLE');
      return {
        id: s.id,
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        screen: s.auditorium.name,
        formats: s.formats,
        film: { id: s.film.id, title: s.film.title, certificate: s.film.certificate, poster: imageRef(pickAsset(s.film.assets, 'POSTER', now)) },
        capacity,
        sold,
        held,
        occupancy: capacity ? Math.round((sold / capacity) * 1000) / 1000 : 0,
        foodOrders: food.find((f) => f.screeningId === s.id)?._count._all ?? 0,
        started: s.startsAt <= now,
      };
    });
    const totals = shows.reduce((a, s) => ({ capacity: a.capacity + s.capacity, sold: a.sold + s.sold, foodOrders: a.foodOrders + s.foodOrders }), { capacity: 0, sold: 0, foodOrders: 0 });
    return { venue: { id: venue.id, name: venue.name, timeZone: venue.timeZone }, date: day, totals: { ...totals, shows: shows.length }, shows };
  }

  /** Everyone who can sign in to this operator's portal. */
  @Get('team')
  async team(@CurrentTenant() t: Tenant) {
    const rows = await this.prisma.adminUser.findMany({ where: { tenantId: t.id }, orderBy: [{ role: 'asc' }, { name: 'asc' }] });
    return rows.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt.toISOString() }));
  }

  /** Adds a person and returns a temporary password once; they sign in with it. */
  @Post('team')
  @Roles('OPERATOR_ADMIN')
  async addMember(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(memberBody)) b: z.infer<typeof memberBody>) {
    const password = temporaryPassword();
    const user = await this.prisma.adminUser
      .create({ data: { tenantId: t.id, name: b.name, email: b.email.toLowerCase(), role: b.role as AdminRole, passwordHash: hashPassword(password) } })
      .catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw Errors.validation('Someone with this email already has access');
        throw e;
      });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'team.add', entityType: 'AdminUser', entityId: user.id, data: { email: user.email, role: user.role } });
    return { member: { id: user.id, name: user.name, email: user.email, role: user.role, createdAt: user.createdAt.toISOString() }, temporaryPassword: password };
  }

  @Put('team/:id')
  @Roles('OPERATOR_ADMIN')
  async changeRole(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string, @Body(new ZodPipe(roleBody)) b: z.infer<typeof roleBody>) {
    const user = await this.member(t, id);
    if (user.id === a.sub) throw Errors.validation('You cannot change your own role');
    if (user.role === 'OPERATOR_ADMIN' && b.role !== 'OPERATOR_ADMIN') await this.keepOneAdmin(t);
    const updated = await this.prisma.adminUser.update({ where: { id }, data: { role: b.role as AdminRole } });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'team.role', entityType: 'AdminUser', entityId: id, data: { from: user.role, to: b.role } });
    return { id: updated.id, name: updated.name, email: updated.email, role: updated.role, createdAt: updated.createdAt.toISOString() };
  }

  @Delete('team/:id')
  @HttpCode(204)
  @Roles('OPERATOR_ADMIN')
  async removeMember(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string) {
    const user = await this.member(t, id);
    if (user.id === a.sub) throw Errors.validation('You cannot remove yourself');
    if (user.role === 'OPERATOR_ADMIN') await this.keepOneAdmin(t);
    await this.prisma.adminUser.delete({ where: { id } });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'team.remove', entityType: 'AdminUser', entityId: id, data: { email: user.email } });
  }

  private async member(t: Tenant, id: string) {
    const user = await this.prisma.adminUser.findFirst({ where: { id, tenantId: t.id } });
    if (!user) throw Errors.notFound('Team member');
    return user;
  }

  /** An operator always keeps at least one admin, so nobody is locked out. */
  private async keepOneAdmin(t: Tenant) {
    const admins = await this.prisma.adminUser.count({ where: { tenantId: t.id, role: 'OPERATOR_ADMIN' } });
    if (admins <= 1) throw Errors.validation('Keep at least one operator admin');
  }
}
