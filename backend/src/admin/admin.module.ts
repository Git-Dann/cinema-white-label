import { Body, Controller, Delete, Get, HttpCode, Module, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma, Tenant } from '@prisma/client';
import { hexSchema, resolveTheme, themeTemplates, validateThemeContrast } from '@cinema/contracts';
import { randomUUID } from 'crypto';
import { mkdirSync } from 'fs';
import { writeFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { z } from 'zod';
import { AuditService } from '../common/common.module';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { AdminGuard, CurrentAdmin, CurrentTenant, Roles, TenantCache } from '../common/tenant-context';
import { AdminClaims, signToken, verifyPassword } from '../common/tokens';
import { ZodPipe } from '../common/zod.pipe';
import { MEDIA_ROOTS } from '../media/media.module';
import { ConfigService, draftSchema, paletteFromRow } from '../tenants/config.service';
import { venueDto } from '../venues/venues.module';
import { filmDto } from '../catalogue/film-dto';
import { Clock } from '../common/clock';
import { TenantsModule } from '../tenants/tenants.module';

const loginBody = z.object({ email: z.string().email(), password: z.string().min(1) });

@ApiTags('Admin')
@Controller('v1/admin')
export class AdminAuthController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('auth/login')
  @HttpCode(200)
  async login(@Body(new ZodPipe(loginBody)) body: z.infer<typeof loginBody>) {
    const user = await this.prisma.adminUser.findUnique({ where: { email: body.email.toLowerCase() }, include: { tenant: true } });
    if (!user || !verifyPassword(body.password, user.passwordHash)) throw Errors.unauthorised();
    const token = signToken({ typ: 'admin', sub: user.id, role: user.role, tid: user.tenantId }, 60 * 60 * 8);
    return { token, user: { id: user.id, email: user.email, name: user.name, role: user.role, tenantSlug: user.tenant?.slug ?? null } };
  }

  @Get('me')
  @ApiBearerAuth()
  @UseGuards(AdminGuard)
  async me(@CurrentAdmin() admin: AdminClaims) {
    const user = await this.prisma.adminUser.findUnique({ where: { id: admin.sub }, include: { tenant: true } });
    if (!user) throw Errors.unauthorised();
    const tenants = admin.role === 'PLATFORM_ADMIN' ? await this.prisma.tenant.findMany({ orderBy: { name: 'asc' } }) : user.tenant ? [user.tenant] : [];
    return { id: user.id, email: user.email, name: user.name, role: user.role, tenants: tenants.map((t) => ({ slug: t.slug, name: t.name })) };
  }
}

const paletteBody = z.object({
  name: z.string().min(1).max(60),
  accent: z.object({ light: hexSchema, dark: hexSchema }),
  secondary: z.object({ light: hexSchema, dark: hexSchema }),
});
const previewBody = z.object({ draft: draftSchema.partial().default({}), palette: paletteBody.optional() });
const publishBody = z.object({ note: z.string().max(200).optional(), scheduledFor: z.string().datetime().optional() });
const uploadBody = z.object({
  kind: z.enum(['LOGO', 'POSTER', 'BACKDROP', 'BANNER']),
  filmId: z.string().optional(),
  dataBase64: z.string().max(14_000_000),
  attribution: z.string().max(200).optional(),
  licenceRef: z.string().max(200).optional(),
});

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('v1/admin/t/:tenant')
@UseGuards(AdminGuard)
export class AdminBrandingController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
    private readonly tenants: TenantCache,
  ) {}

  @Get('settings')
  async settings(@CurrentTenant() t: Tenant) {
    const draft = await this.config.getDraft(t.id);
    const palettes = await this.prisma.brandPalette.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: 'asc' } });
    const preview = await this.config.compose(t, draft, 1).catch(() => null);
    return {
      tenant: { slug: t.slug, name: t.name, currency: t.currency, timeZone: t.timeZone },
      draft,
      themes: themeTemplates(),
      palettes: palettes.map((p) => ({ ...paletteFromRow(p), approved: p.approved })),
      preview: preview ? { theme: preview.config.theme, report: preview.report } : null,
    };
  }

  @Put('settings')
  @Roles('OPERATOR_ADMIN', 'CONTENT_EDITOR')
  update(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(draftSchema.partial())) patch: Partial<z.infer<typeof draftSchema>>) {
    return this.config.updateDraft(t, patch, a.sub);
  }

  /** Live preview: resolve and validate without saving. */
  @Post('preview')
  @HttpCode(200)
  async preview(@CurrentTenant() t: Tenant, @Body(new ZodPipe(previewBody)) body: z.infer<typeof previewBody>) {
    const { config, report } = await this.config.preview(t, body.draft, body.palette ? { id: 'preview', ...body.palette } : undefined);
    return { theme: config.theme, branding: config.branding, report };
  }

  @Get('palettes')
  async palettes(@CurrentTenant() t: Tenant) {
    const rows = await this.prisma.brandPalette.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: 'asc' } });
    return rows.map((p) => ({ ...paletteFromRow(p), approved: p.approved }));
  }

  @Post('palettes')
  @Roles('OPERATOR_ADMIN', 'CONTENT_EDITOR')
  async createPalette(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(paletteBody)) b: z.infer<typeof paletteBody>) {
    const p = await this.prisma.brandPalette.create({
      data: { tenantId: t.id, name: b.name, accentLight: b.accent.light, accentDark: b.accent.dark, secondaryLight: b.secondary.light, secondaryDark: b.secondary.dark, approved: false },
    });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'palette.create', entityType: 'BrandPalette', entityId: p.id, data: b });
    return { ...paletteFromRow(p), approved: p.approved };
  }

  /** Approval checks the palette against every theme the tenant offers. */
  @Post('palettes/:id/approve')
  @HttpCode(200)
  @Roles('OPERATOR_ADMIN')
  async approve(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string) {
    const p = await this.prisma.brandPalette.findFirst({ where: { id, tenantId: t.id } });
    if (!p) throw Errors.notFound('Palette');
    const draft = await this.config.getDraft(t.id);
    const issues = draft.availableThemes.flatMap((themeId) =>
      validateThemeContrast(resolveTheme(themeId, paletteFromRow(p), draft.appearancePolicy ? { appearancePolicy: draft.appearancePolicy } : undefined)).map((i) => ({ themeId, ...i })),
    );
    if (issues.length) throw Errors.publishBlocked(issues);
    const updated = await this.prisma.brandPalette.update({ where: { id }, data: { approved: true } });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'palette.approve', entityType: 'BrandPalette', entityId: id });
    return { ...paletteFromRow(updated), approved: true };
  }

  @Get('releases')
  releases(@CurrentTenant() t: Tenant) {
    return this.prisma.configRelease.findMany({
      where: { tenantId: t.id },
      orderBy: { version: 'desc' },
      select: { id: true, version: true, status: true, note: true, scheduledFor: true, publishedAt: true, createdAt: true },
      take: 50,
    });
  }

  @Post('releases')
  @Roles('OPERATOR_ADMIN')
  async publish(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(publishBody)) b: z.infer<typeof publishBody>) {
    const r = await this.config.publish(t, a.sub, { note: b.note, scheduledFor: b.scheduledFor ? new Date(b.scheduledFor) : undefined });
    this.tenants.invalidate(t.slug);
    return { id: r.id, version: r.version, status: r.status, scheduledFor: r.scheduledFor, publishedAt: r.publishedAt };
  }

  @Post('releases/:version/rollback')
  @Roles('OPERATOR_ADMIN')
  async rollback(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('version') version: string) {
    const r = await this.config.rollback(t, Number(version), a.sub);
    return { id: r.id, version: r.version, status: r.status, note: r.note };
  }

  @Get('audit')
  audit_(@CurrentTenant() t: Tenant) {
    return this.prisma.auditLog.findMany({ where: { tenantId: t.id }, orderBy: { createdAt: 'desc' }, take: 100 });
  }

  /** Uploads are decoded, size-checked and re-encoded (stripping metadata) before storage. */
  @Post('media')
  @Roles('OPERATOR_ADMIN', 'CONTENT_EDITOR')
  async upload(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(uploadBody)) b: z.infer<typeof uploadBody>) {
    const input = Buffer.from(b.dataBase64, 'base64');
    let meta: Awaited<ReturnType<ReturnType<typeof sharp>["metadata"]>>;
    try {
      meta = await sharp(input).metadata();
    } catch {
      throw Errors.validation('File is not a supported image');
    }
    if (!meta.width || !meta.height || meta.width > 6000 || meta.height > 6000) throw Errors.validation('Image dimensions are not supported');
    if (b.filmId && !(await this.prisma.film.findFirst({ where: { id: b.filmId, tenantId: t.id } }))) throw Errors.notFound('Film');
    const isLogo = b.kind === 'LOGO';
    const out = isLogo ? await sharp(input).png().toBuffer() : await sharp(input).rotate().jpeg({ quality: 90 }).toBuffer();
    const dir = join(MEDIA_ROOTS.upload, t.id);
    mkdirSync(dir, { recursive: true });
    const name = `${randomUUID()}.${isLogo ? 'png' : 'jpg'}`;
    await writeFile(join(dir, name), out);
    const stats = await sharp(out).stats();
    const d = stats.dominant;
    const asset = await this.prisma.mediaAsset.create({
      data: {
        tenantId: t.id, filmId: b.filmId ?? null, kind: b.kind, provider: 'operator', sourceRef: `upload:${name}`, storageKey: `upload/${t.id}/${name}`,
        width: meta.width, height: meta.height, mimeType: isLogo ? 'image/png' : 'image/jpeg', attribution: b.attribution ?? null, licenceRef: b.licenceRef ?? null,
        dominantColor: `#${[d.r, d.g, d.b].map((x) => x.toString(16).padStart(2, '0')).join('')}`.toUpperCase(),
        approvedContexts: isLogo ? ['branding'] : ['list', 'detail'],
      },
    });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'media.upload', entityType: 'MediaAsset', entityId: asset.id, data: { kind: b.kind, filmId: b.filmId } });
    return { id: asset.id, url: `/v1/media/${asset.id}`, width: asset.width, height: asset.height };
  }
}

const venueBody = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string().min(1),
  addressLine1: z.string().min(1),
  city: z.string().min(1),
  postcode: z.string().min(2),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  phone: z.string().nullable().default(null),
  facilities: z.array(z.string()).default([]),
});
const filmBody = z.object({
  slug: z.string().regex(/^[a-z0-9-]+$/),
  title: z.string().min(1),
  tagline: z.string().nullable().default(null),
  synopsis: z.string().min(1),
  releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  runtimeMinutes: z.number().int().positive(),
  certificate: z.enum(['U', 'PG', '12A', '12', '15', '18', 'TBC']),
  genres: z.array(z.string()).default([]),
  director: z.string().nullable().default(null),
  cast: z.array(z.string()).default([]),
});
const focalBody = z.object({ focalX: z.number().min(0).max(1), focalY: z.number().min(0).max(1), isPreferred: z.boolean().optional() });

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('v1/admin/t/:tenant')
@UseGuards(AdminGuard)
export class AdminContentController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly clock: Clock) {}

  @Get('venues')
  async venues(@CurrentTenant() t: Tenant) {
    const rows = await this.prisma.venue.findMany({ where: { tenantId: t.id }, include: { auditoriums: { select: { id: true } } }, orderBy: { name: 'asc' } });
    return rows.map((v) => venueDto(v));
  }

  @Post('venues')
  @Roles('OPERATOR_ADMIN', 'VENUE_MANAGER')
  async createVenue(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(venueBody)) b: z.infer<typeof venueBody>) {
    const v = await this.prisma.venue.create({ data: { ...b, tenantId: t.id, timeZone: t.timeZone } }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw Errors.validation('A cinema with this slug already exists');
      throw e;
    });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'venue.create', entityType: 'Venue', entityId: v.id, data: b });
    return venueDto(v);
  }

  @Put('venues/:id')
  @Roles('OPERATOR_ADMIN', 'VENUE_MANAGER')
  async updateVenue(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string, @Body(new ZodPipe(venueBody.partial())) b: Partial<z.infer<typeof venueBody>>) {
    const res = await this.prisma.venue.updateMany({ where: { id, tenantId: t.id }, data: b });
    if (!res.count) throw Errors.notFound('Cinema');
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'venue.update', entityType: 'Venue', entityId: id, data: b });
    return venueDto(await this.prisma.venue.findUniqueOrThrow({ where: { id } }));
  }

  @Delete('venues/:id')
  @HttpCode(204)
  @Roles('OPERATOR_ADMIN')
  async deleteVenue(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string) {
    const bookings = await this.prisma.booking.count({ where: { tenantId: t.id, screening: { venueId: id }, status: 'CONFIRMED' } });
    if (bookings) throw Errors.validation('This cinema has confirmed bookings and cannot be deleted');
    const res = await this.prisma.venue.deleteMany({ where: { id, tenantId: t.id } });
    if (!res.count) throw Errors.notFound('Cinema');
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'venue.delete', entityType: 'Venue', entityId: id });
  }

  @Get('films')
  async films(@CurrentTenant() t: Tenant) {
    const rows = await this.prisma.film.findMany({ where: { tenantId: t.id }, include: { assets: true }, orderBy: { releaseDate: 'desc' } });
    const now = this.clock.now();
    return rows.map((f) => ({
      ...filmDto(f, now),
      provenance: f.provenance,
      assets: f.assets.map((x) => ({ id: x.id, kind: x.kind, provider: x.provider, width: x.width, height: x.height, focalX: x.focalX, focalY: x.focalY, isPreferred: x.isPreferred, licenceRef: x.licenceRef, attribution: x.attribution, expiresAt: x.expiresAt, url: `/v1/media/${x.id}?v=${x.updatedAt.getTime()}` })),
    }));
  }

  @Post('films')
  @Roles('OPERATOR_ADMIN', 'CONTENT_EDITOR')
  async createFilm(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(filmBody)) b: z.infer<typeof filmBody>) {
    const f = await this.prisma.film.create({
      data: { ...b, tenantId: t.id, releaseDate: new Date(`${b.releaseDate}T00:00:00Z`), provenance: Object.fromEntries(Object.keys(b).map((k) => [k, 'operator'])) },
      include: { assets: true },
    }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw Errors.validation('A film with this slug already exists');
      throw e;
    });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'film.create', entityType: 'Film', entityId: f.id, data: b });
    return filmDto(f, this.clock.now());
  }

  @Put('films/:id')
  @Roles('OPERATOR_ADMIN', 'CONTENT_EDITOR')
  async updateFilm(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string, @Body(new ZodPipe(filmBody.partial())) b: Partial<z.infer<typeof filmBody>>) {
    const existing = await this.prisma.film.findFirst({ where: { id, tenantId: t.id } });
    if (!existing) throw Errors.notFound('Film');
    // Manual edits take provenance "operator" so later provider syncs do not overwrite them.
    const provenance = { ...(existing.provenance as Record<string, string>), ...Object.fromEntries(Object.keys(b).map((k) => [k, 'operator'])) };
    const f = await this.prisma.film.update({
      where: { id },
      data: { ...b, ...(b.releaseDate ? { releaseDate: new Date(`${b.releaseDate}T00:00:00Z`) } : {}), provenance },
      include: { assets: true },
    });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'film.update', entityType: 'Film', entityId: id, data: b });
    return filmDto(f, this.clock.now());
  }

  @Put('assets/:id')
  @Roles('OPERATOR_ADMIN', 'CONTENT_EDITOR')
  async updateAsset(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string, @Body(new ZodPipe(focalBody)) b: z.infer<typeof focalBody>) {
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id, tenantId: t.id } });
    if (!asset) throw Errors.notFound('Image');
    await this.prisma.$transaction(async (tx) => {
      if (b.isPreferred && asset.filmId) await tx.mediaAsset.updateMany({ where: { filmId: asset.filmId, kind: asset.kind }, data: { isPreferred: false } });
      await tx.mediaAsset.update({ where: { id }, data: { focalX: b.focalX, focalY: b.focalY, ...(b.isPreferred !== undefined ? { isPreferred: b.isPreferred } : {}) } });
    });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'asset.update', entityType: 'MediaAsset', entityId: id, data: b });
    return { ok: true };
  }

  @Get('stats')
  async stats(@CurrentTenant() t: Tenant, @Query('days') days?: string) {
    const since = new Date(this.clock.now().getTime() - (Number(days) || 30) * 86400_000);
    const [bookings, revenue, events, venues, films] = await Promise.all([
      this.prisma.booking.count({ where: { tenantId: t.id, status: 'CONFIRMED', confirmedAt: { gte: since } } }),
      this.prisma.booking.aggregate({ where: { tenantId: t.id, status: 'CONFIRMED', confirmedAt: { gte: since } }, _sum: { totalMinor: true } }),
      this.prisma.analyticsEvent.groupBy({ by: ['name'], where: { tenantId: t.id, occurredAt: { gte: since } }, _count: { _all: true } }),
      this.prisma.venue.count({ where: { tenantId: t.id } }),
      this.prisma.film.count({ where: { tenantId: t.id } }),
    ]);
    return {
      currency: t.currency,
      bookings,
      revenueMinor: revenue._sum.totalMinor ?? 0,
      venues,
      films,
      events: Object.fromEntries(events.map((e) => [e.name, e._count._all])),
    };
  }
}

@Module({
  imports: [TenantsModule],
  controllers: [AdminAuthController, AdminBrandingController, AdminContentController],
})
export class AdminModule {}
