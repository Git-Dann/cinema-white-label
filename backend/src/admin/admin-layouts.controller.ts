import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma, Tenant } from '@prisma/client';
import { AuditoriumLayout, auditoriumLayoutSchema, validateLayout } from '@cinema/contracts';
import { z } from 'zod';
import { AuditService } from '../common/common.module';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { AdminGuard, CurrentAdmin, CurrentTenant, Roles } from '../common/tenant-context';
import { AdminClaims } from '../common/tokens';
import { ZodPipe } from '../common/zod.pipe';

const auditoriumBody = z.object({ name: z.string().min(1).max(40), screenNumber: z.number().int().min(1).max(99) });
const layoutBody = z.object({ geometry: auditoriumLayoutSchema });

/**
 * Auditorium layout lifecycle: DRAFT (editable) → PUBLISHED (immutable) → RETIRED.
 * Publishing a new version never changes existing screenings: they keep the
 * version they were created with, so booked seats can't move under customers.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('v1/admin/t/:tenant')
@UseGuards(AdminGuard)
export class AdminLayoutsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService) {}

  private summary(v: { id: string; version: number; status: string; seatCount: number; publishedAt: Date | null; createdAt: Date }) {
    return { id: v.id, version: v.version, status: v.status, seatCount: v.seatCount, publishedAt: v.publishedAt, createdAt: v.createdAt };
  }

  @Get('auditoriums')
  async auditoriums(@CurrentTenant() t: Tenant) {
    const venues = await this.prisma.venue.findMany({
      where: { tenantId: t.id },
      orderBy: { name: 'asc' },
      include: { auditoriums: { orderBy: { screenNumber: 'asc' }, include: { layouts: { orderBy: { version: 'desc' } } } } },
    });
    return venues.map((v) => ({
      venue: { id: v.id, name: v.name },
      auditoriums: v.auditoriums.map((a) => ({
        id: a.id,
        name: a.name,
        screenNumber: a.screenNumber,
        versions: a.layouts.map((l) => this.summary(l)),
      })),
    }));
  }

  @Post('venues/:venueId/auditoriums')
  @Roles('OPERATOR_ADMIN', 'VENUE_MANAGER')
  async createAuditorium(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('venueId') venueId: string, @Body(new ZodPipe(auditoriumBody)) b: z.infer<typeof auditoriumBody>) {
    const venue = await this.prisma.venue.findFirst({ where: { id: venueId, tenantId: t.id } });
    if (!venue) throw Errors.notFound('Cinema');
    const aud = await this.prisma.auditorium.create({ data: { tenantId: t.id, venueId, ...b } }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw Errors.validation(`Screen ${b.screenNumber} already exists at this cinema`);
      throw e;
    });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'auditorium.create', entityType: 'Auditorium', entityId: aud.id, data: b });
    return { id: aud.id, name: aud.name, screenNumber: aud.screenNumber, versions: [] };
  }

  @Put('auditoriums/:id')
  @Roles('OPERATOR_ADMIN', 'VENUE_MANAGER')
  async renameAuditorium(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string, @Body(new ZodPipe(auditoriumBody.partial())) b: Partial<z.infer<typeof auditoriumBody>>) {
    await this.auditorium(t, id);
    const aud = await this.prisma.auditorium.update({ where: { id }, data: b }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw Errors.validation(`Screen ${b.screenNumber} already exists at this cinema`);
      throw e;
    });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'auditorium.update', entityType: 'Auditorium', entityId: id, data: b });
    return { id: aud.id, name: aud.name, screenNumber: aud.screenNumber };
  }

  /** Only screens that have never had screenings can be deleted; otherwise booking history would break. */
  @Delete('auditoriums/:id')
  @HttpCode(204)
  @Roles('OPERATOR_ADMIN')
  async deleteAuditorium(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string) {
    await this.auditorium(t, id);
    const screenings = await this.prisma.screening.count({ where: { auditoriumId: id } });
    if (screenings) throw Errors.validation(`This screen has ${screenings} screening(s) and cannot be deleted`);
    await this.prisma.auditorium.delete({ where: { id } });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'auditorium.delete', entityType: 'Auditorium', entityId: id });
  }

  private async auditorium(t: Tenant, id: string) {
    const aud = await this.prisma.auditorium.findFirst({ where: { id, tenantId: t.id } });
    if (!aud) throw Errors.notFound('Auditorium');
    return aud;
  }

  private async version(t: Tenant, id: string) {
    const v = await this.prisma.auditoriumLayoutVersion.findFirst({ where: { id, auditorium: { tenantId: t.id } }, include: { auditorium: true } });
    if (!v) throw Errors.notFound('Layout version');
    return v;
  }

  /** Category ids used by seats must exist and be priced, or the seats couldn't be sold. */
  private async categoryIssues(t: Tenant, geometry: AuditoriumLayout) {
    const used = [...new Set(geometry.seats.map((s) => s.priceCategory))];
    const known = new Set((await this.prisma.seatCategory.findMany({ where: { tenantId: t.id, code: { in: used } }, select: { code: true } })).map((c) => c.code));
    const priced = new Set((await this.prisma.priceRule.findMany({ where: { tenantId: t.id, priceCategory: { in: used } }, select: { priceCategory: true } })).map((p) => p.priceCategory));
    return used.flatMap((c) => [
      ...(known.has(c) ? [] : [{ code: 'category.unknown', message: `Seat category "${c}" does not exist` }]),
      ...(priced.has(c) ? [] : [{ code: 'category.unpriced', message: `Seat category "${c}" has no ticket prices` }]),
    ]);
  }

  @Get('layouts/:versionId')
  async getVersion(@CurrentTenant() t: Tenant, @Param('versionId') versionId: string) {
    const v = await this.version(t, versionId);
    const geometry = v.geometry as unknown as AuditoriumLayout;
    const screenings = await this.prisma.screening.count({ where: { layoutVersionId: v.id } });
    return { ...this.summary(v), auditorium: { id: v.auditorium.id, name: v.auditorium.name }, geometry, screenings, issues: [...validateLayout(geometry), ...(await this.categoryIssues(t, geometry))] };
  }

  /** Validate without saving, for live feedback in the editor. */
  @Post('layouts/validate')
  @HttpCode(200)
  async validate(@CurrentTenant() t: Tenant, @Body(new ZodPipe(layoutBody)) b: z.infer<typeof layoutBody>) {
    const issues = [...validateLayout(b.geometry), ...(await this.categoryIssues(t, b.geometry))];
    return { ok: issues.length === 0, issues, seatCount: b.geometry.seats.length };
  }

  /** Creates a new draft version (optionally copied from geometry sent by the editor). */
  @Post('auditoriums/:id/layouts')
  @Roles('OPERATOR_ADMIN', 'VENUE_MANAGER')
  async createDraft(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string, @Body(new ZodPipe(layoutBody)) b: z.infer<typeof layoutBody>) {
    await this.auditorium(t, id);
    const draft = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'layout:' + id}))`;
      if (await tx.auditoriumLayoutVersion.findFirst({ where: { auditoriumId: id, status: 'DRAFT' } })) throw Errors.validation('This auditorium already has a draft. Edit or delete it first.');
      const last = await tx.auditoriumLayoutVersion.findFirst({ where: { auditoriumId: id }, orderBy: { version: 'desc' } });
      const version = (last?.version ?? 0) + 1;
      const geometry = { ...b.geometry, version };
      return tx.auditoriumLayoutVersion.create({ data: { auditoriumId: id, version, status: 'DRAFT', geometry: geometry as unknown as Prisma.InputJsonValue, seatCount: geometry.seats.length } });
    });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'layout.draft.create', entityType: 'AuditoriumLayoutVersion', entityId: draft.id, data: { version: draft.version } });
    return this.getVersion(t, draft.id);
  }

  @Put('layouts/:versionId')
  @Roles('OPERATOR_ADMIN', 'VENUE_MANAGER')
  async updateDraft(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('versionId') versionId: string, @Body(new ZodPipe(layoutBody)) b: z.infer<typeof layoutBody>) {
    const v = await this.version(t, versionId);
    if (v.status !== 'DRAFT') throw Errors.validation('Published layouts cannot be edited. Create a new draft instead.');
    const geometry = { ...b.geometry, version: v.version };
    await this.prisma.auditoriumLayoutVersion.update({ where: { id: v.id }, data: { geometry: geometry as unknown as Prisma.InputJsonValue, seatCount: geometry.seats.length } });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'layout.draft.update', entityType: 'AuditoriumLayoutVersion', entityId: v.id, data: { seats: geometry.seats.length } });
    return this.getVersion(t, v.id);
  }

  @Delete('layouts/:versionId')
  @HttpCode(204)
  @Roles('OPERATOR_ADMIN', 'VENUE_MANAGER')
  async deleteDraft(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('versionId') versionId: string) {
    const v = await this.version(t, versionId);
    if (v.status !== 'DRAFT') throw Errors.validation('Only drafts can be deleted');
    await this.prisma.auditoriumLayoutVersion.delete({ where: { id: v.id } });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'layout.draft.delete', entityType: 'AuditoriumLayoutVersion', entityId: v.id });
  }

  /** Validates then publishes; the previous published version is retired for new screenings only. */
  @Post('layouts/:versionId/publish')
  @HttpCode(200)
  @Roles('OPERATOR_ADMIN')
  async publish(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('versionId') versionId: string) {
    const v = await this.version(t, versionId);
    if (v.status !== 'DRAFT') throw Errors.validation('Only drafts can be published');
    const geometry = v.geometry as unknown as AuditoriumLayout;
    const issues = [...validateLayout(geometry), ...(await this.categoryIssues(t, geometry))];
    if (issues.length) throw Errors.publishBlocked(issues);
    await this.prisma.$transaction([
      this.prisma.auditoriumLayoutVersion.updateMany({ where: { auditoriumId: v.auditoriumId, status: 'PUBLISHED' }, data: { status: 'RETIRED' } }),
      this.prisma.auditoriumLayoutVersion.update({ where: { id: v.id }, data: { status: 'PUBLISHED', publishedAt: new Date() } }),
    ]);
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'layout.publish', entityType: 'AuditoriumLayoutVersion', entityId: v.id, data: { version: v.version, seats: geometry.seats.length } });
    return this.getVersion(t, v.id);
  }
}
