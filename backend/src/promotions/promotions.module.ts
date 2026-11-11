import { Body, Controller, Delete, Get, HttpCode, Injectable, Module, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MediaAsset, Prisma, Promotion, Tenant } from '@prisma/client';
import { ImageRef, imageRef, pickAsset } from '../catalogue/film-dto';
import { z } from 'zod';
import { AuditService } from '../common/common.module';
import { Clock } from '../common/clock';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { AdminGuard, CurrentAdmin, CurrentTenant, Roles, TenantGuard } from '../common/tenant-context';
import { AdminClaims } from '../common/tokens';
import { ZodPipe } from '../common/zod.pipe';

export const PROMOTION_ACTIONS = ['film', 'voucher', 'link', 'none'] as const;

const promotionFields = z.object({
  title: z.string().trim().min(1).max(60),
  body: z.string().trim().min(1).max(200),
  ctaLabel: z.string().trim().max(24).default(''),
  action: z.enum(PROMOTION_ACTIONS),
  filmId: z.string().nullable().default(null),
  voucherCode: z.string().trim().toUpperCase().nullable().default(null),
  // https only: the app opens these in Safari and must never be pointed at plain http.
  linkUrl: z.string().url().startsWith('https://', 'Links must start with https://').max(500).nullable().default(null),
  /** A photo uploaded with kind BANNER, or null. */
  imageAssetId: z.string().nullable().default(null),
  venueId: z.string().nullable().default(null),
  validFrom: z.string().datetime().nullable().default(null),
  validTo: z.string().datetime().nullable().default(null),
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

type PromotionInput = z.infer<typeof promotionFields>;

/** Cross-field rules, applied to the merged record on create and update. */
function checkShape(p: PromotionInput) {
  if (p.validFrom && p.validTo && p.validFrom >= p.validTo) throw Errors.validation('End date must be after start date');
  const needs: Record<(typeof PROMOTION_ACTIONS)[number], keyof PromotionInput | null> = { film: 'filmId', voucher: 'voucherCode', link: 'linkUrl', none: null };
  const field = needs[p.action];
  if (field && !p[field]) throw Errors.validation(`Choose a ${field === 'filmId' ? 'film' : field === 'voucherCode' ? 'voucher' : 'link'} for this promotion`);
  if (p.action !== 'none' && !p.ctaLabel) throw Errors.validation('Add a button label, such as "Book now"');
}

export type PromotionAction = { kind: 'film'; filmId: string } | { kind: 'voucher'; code: string } | { kind: 'link'; url: string } | { kind: 'none' };

export interface PromotionDto {
  id: string;
  title: string;
  body: string;
  ctaLabel: string | null;
  action: PromotionAction;
  validTo: string | null;
  /** The banner photo; for a film offer without one, the film's backdrop. Null shows a type-only banner. */
  image: ImageRef | null;
}

@Injectable()
export class PromotionsService {
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock) {}

  /**
   * Live promotions for the customer app: active, inside their dates, for this
   * cinema or all cinemas, and only while their target still works.
   */
  async live(tenantId: string, venueId?: string): Promise<PromotionDto[]> {
    const now = this.clock.now();
    const rows = await this.prisma.promotion.findMany({
      where: {
        tenantId,
        active: true,
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validTo: null }, { validTo: { gt: now } }] },
          venueId ? { OR: [{ venueId: null }, { venueId }] } : { venueId: null },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }],
      take: 10,
    });
    const codes = rows.filter((r) => r.action === 'voucher' && r.voucherCode).map((r) => r.voucherCode!);
    const filmIds = rows.filter((r) => r.action === 'film' && r.filmId).map((r) => r.filmId!);
    const [vouchers, films] = await Promise.all([
      codes.length ? this.prisma.voucher.findMany({ where: { tenantId, code: { in: codes } } }) : [],
      filmIds.length ? this.prisma.film.findMany({ where: { tenantId, id: { in: filmIds } }, select: { id: true } }) : [],
    ]);
    const redeemable = new Set(
      vouchers
        .filter((v) => v.active && (!v.validFrom || v.validFrom <= now) && (!v.validTo || v.validTo > now) && (v.maxRedemptions == null || v.redemptions < v.maxRedemptions))
        .map((v) => v.code),
    );
    const filmSet = new Set(films.map((f) => f.id));
    const shown = rows.filter((r) => (r.action === 'voucher' ? redeemable.has(r.voucherCode ?? '') : r.action === 'film' ? filmSet.has(r.filmId ?? '') : true));
    const images = await this.images(tenantId, shown);
    return shown.map((r) => toDto(r, images.get(r.id) ?? null));
  }

  /** Banner photo per promotion: its own upload, else (film offers) the film's backdrop. */
  async images(tenantId: string, rows: Promotion[]): Promise<Map<string, MediaAsset | null>> {
    const own = rows.map((r) => r.imageAssetId).filter((x): x is string => !!x);
    const filmIds = rows.filter((r) => !r.imageAssetId && r.action === 'film' && r.filmId).map((r) => r.filmId!);
    const [assets, backdrops] = await Promise.all([
      own.length ? this.prisma.mediaAsset.findMany({ where: { tenantId, id: { in: own } } }) : [],
      filmIds.length ? this.prisma.mediaAsset.findMany({ where: { tenantId, filmId: { in: filmIds }, kind: 'BACKDROP' } }) : [],
    ]);
    const now = this.clock.now();
    return new Map(
      rows.map((r) => [
        r.id,
        r.imageAssetId ? assets.find((a) => a.id === r.imageAssetId) ?? null : r.action === 'film' ? pickAsset(backdrops.filter((b) => b.filmId === r.filmId), 'BACKDROP', now) ?? null : null,
      ]),
    );
  }
}

export function toDto(r: Promotion, image: MediaAsset | null = null): PromotionDto {
  const action: PromotionAction =
    r.action === 'film' && r.filmId ? { kind: 'film', filmId: r.filmId }
    : r.action === 'voucher' && r.voucherCode ? { kind: 'voucher', code: r.voucherCode }
    : r.action === 'link' && r.linkUrl ? { kind: 'link', url: r.linkUrl }
    : { kind: 'none' };
  return { id: r.id, title: r.title, body: r.body, ctaLabel: action.kind === 'none' ? null : r.ctaLabel, action, validTo: r.validTo?.toISOString() ?? null, image: imageRef(image) };
}

@ApiTags('Promotions')
@Controller('v1/t/:tenant/promotions')
@UseGuards(TenantGuard)
export class PromotionsController {
  constructor(private readonly promotions: PromotionsService) {}

  @Get()
  @ApiQuery({ name: 'venueId', required: false, description: 'Include promotions for this cinema as well as operator-wide ones' })
  list(@CurrentTenant() t: Tenant, @Query('venueId') venueId?: string) {
    return this.promotions.live(t.id, venueId || undefined);
  }
}

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('v1/admin/t/:tenant/promotions')
@UseGuards(AdminGuard)
export class AdminPromotionsController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly promotions: PromotionsService) {}

  @Get()
  async list(@CurrentTenant() t: Tenant) {
    const [rows, live] = await Promise.all([
      this.prisma.promotion.findMany({ where: { tenantId: t.id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'desc' }] }),
      this.promotions.live(t.id),
    ]);
    const liveIds = new Set(live.map((p) => p.id));
    const images = await this.promotions.images(t.id, rows);
    // `showing` tells operators whether customers can currently see it (operator-wide ones only).
    return rows.map((r) => ({ ...r, showing: r.venueId ? null : liveIds.has(r.id), image: imageRef(images.get(r.id)) }));
  }

  /** References must belong to this operator; voucher codes must exist. */
  private async assertTargets(t: Tenant, p: PromotionInput) {
    if (p.action === 'film' && !(await this.prisma.film.findFirst({ where: { id: p.filmId!, tenantId: t.id } }))) throw Errors.notFound('Film');
    if (p.action === 'voucher' && !(await this.prisma.voucher.findFirst({ where: { code: p.voucherCode!, tenantId: t.id } }))) throw Errors.validation(`No voucher with code ${p.voucherCode}`);
    if (p.venueId && !(await this.prisma.venue.findFirst({ where: { id: p.venueId, tenantId: t.id } }))) throw Errors.notFound('Cinema');
    if (p.imageAssetId) {
      const asset = await this.prisma.mediaAsset.findFirst({ where: { id: p.imageAssetId, tenantId: t.id } });
      if (!asset || asset.kind !== 'BANNER') throw Errors.validation('Choose a photo uploaded for this offer');
    }
  }

  /** Clears target fields the chosen action does not use, so stale links never resurface. */
  private data(p: PromotionInput) {
    return {
      title: p.title, body: p.body, ctaLabel: p.ctaLabel, action: p.action,
      filmId: p.action === 'film' ? p.filmId : null,
      voucherCode: p.action === 'voucher' ? p.voucherCode : null,
      linkUrl: p.action === 'link' ? p.linkUrl : null,
      imageAssetId: p.imageAssetId,
      venueId: p.venueId,
      validFrom: p.validFrom ? new Date(p.validFrom) : null,
      validTo: p.validTo ? new Date(p.validTo) : null,
      active: p.active, sortOrder: p.sortOrder,
    } satisfies Omit<Prisma.PromotionUncheckedCreateInput, 'tenantId'>;
  }

  @Post()
  @Roles('OPERATOR_ADMIN', 'CONTENT_EDITOR')
  async create(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(promotionFields)) b: PromotionInput) {
    checkShape(b);
    await this.assertTargets(t, b);
    const row = await this.prisma.promotion.create({ data: { tenantId: t.id, ...this.data(b) } });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'promotion.create', entityType: 'Promotion', entityId: row.id, data: b });
    return row;
  }

  @Put(':id')
  @Roles('OPERATOR_ADMIN', 'CONTENT_EDITOR')
  async update(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string, @Body(new ZodPipe(promotionFields.partial())) b: Partial<PromotionInput>) {
    const existing = await this.prisma.promotion.findFirst({ where: { id, tenantId: t.id } });
    if (!existing) throw Errors.notFound('Promotion');
    const merged = promotionFields.parse({
      ...existing,
      validFrom: existing.validFrom?.toISOString() ?? null,
      validTo: existing.validTo?.toISOString() ?? null,
      ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)),
    });
    checkShape(merged);
    await this.assertTargets(t, merged);
    const row = await this.prisma.promotion.update({ where: { id }, data: this.data(merged) });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'promotion.update', entityType: 'Promotion', entityId: id, data: b });
    return row;
  }

  @Delete(':id')
  @HttpCode(204)
  @Roles('OPERATOR_ADMIN', 'CONTENT_EDITOR')
  async remove(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string) {
    const res = await this.prisma.promotion.deleteMany({ where: { id, tenantId: t.id } });
    if (!res.count) throw Errors.notFound('Promotion');
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'promotion.delete', entityType: 'Promotion', entityId: id });
  }
}

@Module({ controllers: [PromotionsController, AdminPromotionsController], providers: [PromotionsService] })
export class PromotionsModule {}
