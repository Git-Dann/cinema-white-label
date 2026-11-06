import { imageRef } from '../catalogue/film-dto';
import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Prisma, Tenant } from '@prisma/client';
import { AuditoriumLayout, resolveTheme, SEAT_ICONS, SEAT_SHAPES, seatCategorySchema, validateSeatCategories } from '@cinema/contracts';
import { z } from 'zod';
import { AuditService } from '../common/common.module';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { AdminGuard, CurrentAdmin, CurrentTenant, Roles, TenantCache } from '../common/tenant-context';
import { AdminClaims } from '../common/tokens';
import { ZodPipe } from '../common/zod.pipe';
import { ConfigService, paletteFromRow } from '../tenants/config.service';

const categoryBody = seatCategorySchema;
const categoryPatch = seatCategorySchema.omit({ id: true }).partial();
const pricingBody = z.object({
  prices: z.array(z.object({ ticketTypeId: z.string(), priceCategory: z.string(), amountMinor: z.number().int().min(0).max(100_000).nullable() })).max(500),
});

/** Formats are free text on screenings (2D, IMAX, 4DX, Dolby Atmos…); keep them short and printable. */
const FORMAT = /^[A-Za-z0-9][A-Za-z0-9 +\-]{0,19}$/;
const feesBody = z
  .object({
    bookingFeePerTicketMinor: z.number().int().min(0).max(1_000),
    supplements: z.array(z.object({ format: z.string().trim().regex(FORMAT, 'Format names use letters, numbers, spaces, + or -'), amountMinor: z.number().int().min(0).max(5_000) })).max(20),
  })
  .refine((b) => new Set(b.supplements.map((s) => s.format.toLowerCase())).size === b.supplements.length, 'Each format can only have one supplement');

const modifierGroupSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string().min(1).max(40),
    min: z.number().int().min(0).max(10),
    max: z.number().int().min(1).max(10),
    options: z.array(z.object({ id: z.string().regex(/^[a-z0-9-]+$/), name: z.string().min(1).max(40), priceMinor: z.number().int().min(0).max(10_000) })).min(1).max(20),
  })
  .refine((g) => g.min <= g.max && g.max <= g.options.length, 'min must be ≤ max ≤ number of options')
  .refine((g) => new Set(g.options.map((o) => o.id)).size === g.options.length, 'option ids must be unique');

const concessionBody = z.object({
  sku: z.string().regex(/^[A-Z0-9-]+$/).max(30),
  name: z.string().min(1).max(60),
  description: z.string().max(200).nullable().default(null),
  category: z.string().min(1).max(30),
  priceMinor: z.number().int().min(0).max(100_000),
  allergens: z.array(z.string().max(30)).max(14).default([]),
  dietary: z.array(z.string().max(30)).max(6).default([]),
  calories: z.number().int().min(0).max(5000).nullable().default(null),
  stockStatus: z.enum(['inStock', 'low', 'out']).default('inStock'),
  available: z.boolean().default(true),
  venueId: z.string().nullable().default(null),
  modifierGroups: z.array(modifierGroupSchema).max(6).default([]),
  bundleItems: z.array(z.string().max(60)).max(8).default([]),
  sortOrder: z.number().int().default(0),
  /** A PRODUCT image uploaded through POST media, or null for none. */
  imageAssetId: z.string().nullable().default(null),
  featured: z.boolean().default(false),
  badge: z.string().trim().max(24).nullable().default(null),
  compareAtMinor: z.number().int().min(0).max(100_000).nullable().default(null),
  filmId: z.string().nullable().default(null),
  limitedEdition: z.boolean().default(false),
  availableFrom: z.string().datetime().nullable().default(null),
  availableUntil: z.string().datetime().nullable().default(null),
});

/** Cross-field rules shared by create and update (update checks the merged result). */
function assertProductRules(p: { priceMinor: number; compareAtMinor: number | null; availableFrom: Date | string | null; availableUntil: Date | string | null }) {
  if (p.compareAtMinor !== null && p.compareAtMinor <= p.priceMinor) throw Errors.validation('The "was" price must be higher than the price');
  if (p.availableFrom && p.availableUntil && new Date(p.availableUntil) <= new Date(p.availableFrom)) throw Errors.validation('The sale must end after it starts');
}

const dates = (b: { availableFrom?: string | null; availableUntil?: string | null }) => ({
  ...(b.availableFrom !== undefined ? { availableFrom: b.availableFrom ? new Date(b.availableFrom) : null } : {}),
  ...(b.availableUntil !== undefined ? { availableUntil: b.availableUntil ? new Date(b.availableUntil) : null } : {}),
});

const voucherBody = z
  .object({
    code: z.string().regex(/^[A-Za-z0-9-]{3,20}$/).transform((c) => c.toUpperCase()),
    description: z.string().min(1).max(100),
    kind: z.enum(['percentOff', 'amountOff']),
    value: z.number().int().min(1),
    appliesTo: z.enum(['tickets', 'concessions', 'all']).default('all'),
    minSpendMinor: z.number().int().min(0).default(0),
    validFrom: z.string().datetime().nullable().default(null),
    validTo: z.string().datetime().nullable().default(null),
    maxRedemptions: z.number().int().min(1).nullable().default(null),
    active: z.boolean().default(true),
    /** Null = valid at every cinema. */
    venueId: z.string().nullable().default(null),
  })
  .refine((v) => v.kind !== 'percentOff' || v.value <= 100, 'Percentage must be 100 or less')
  .refine((v) => !v.validFrom || !v.validTo || v.validFrom < v.validTo, 'End date must be after start date');

function categoryDto(c: { code: string; label: string; description: string | null; shape: string; icon: string | null; colours: Prisma.JsonValue; sortOrder: number }) {
  return { id: c.code, label: c.label, description: c.description, shape: c.shape, icon: c.icon, colours: c.colours ?? null, sortOrder: c.sortOrder };
}

/**
 * Operator management of seat categories and their prices, food and drink,
 * and vouchers. Everything is validated server-side and audited.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('v1/admin/t/:tenant')
@UseGuards(AdminGuard)
export class AdminCommerceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
    private readonly tenants: TenantCache,
  ) {}

  // ---------------- Seat categories ----------------

  @Get('seat-categories')
  async categories(@CurrentTenant() t: Tenant) {
    const rows = await this.prisma.seatCategory.findMany({ where: { tenantId: t.id }, orderBy: { sortOrder: 'asc' } });
    return { categories: rows.map(categoryDto), shapes: SEAT_SHAPES, icons: SEAT_ICONS };
  }

  /** Category colours must stay legible on every theme the operator offers. */
  private async assertLegible(t: Tenant, categories: z.infer<typeof categoryBody>[]) {
    const draft = await this.config.getDraft(t.id);
    const palette = await this.prisma.brandPalette.findFirst({ where: { id: draft.paletteId, tenantId: t.id } });
    if (!palette) return;
    const issues = draft.availableThemes.flatMap((themeId) =>
      validateSeatCategories(categories, resolveTheme(themeId, paletteFromRow(palette))).map((i) => ({ themeId, ...i })),
    );
    if (issues.length) throw Errors.validation(issues[0].message, { issues });
  }

  @Post('seat-categories')
  @Roles('OPERATOR_ADMIN', 'VENUE_MANAGER')
  async createCategory(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(categoryBody)) b: z.infer<typeof categoryBody>) {
    if (await this.prisma.seatCategory.findUnique({ where: { tenantId_code: { tenantId: t.id, code: b.id } } })) throw Errors.validation('A category with this id already exists');
    await this.assertLegible(t, [b]);
    const row = await this.prisma.seatCategory.create({
      data: { tenantId: t.id, code: b.id, label: b.label, description: b.description, shape: b.shape, icon: b.icon, colours: b.colours ?? Prisma.JsonNull, sortOrder: b.sortOrder },
    });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'seatCategory.create', entityType: 'SeatCategory', entityId: row.id, data: b });
    return categoryDto(row);
  }

  @Put('seat-categories/:code')
  @Roles('OPERATOR_ADMIN', 'VENUE_MANAGER')
  async updateCategory(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('code') code: string, @Body(new ZodPipe(categoryPatch)) b: z.infer<typeof categoryPatch>) {
    const existing = await this.prisma.seatCategory.findUnique({ where: { tenantId_code: { tenantId: t.id, code } } });
    if (!existing) throw Errors.notFound('Seat category');
    const merged = seatCategorySchema.parse({ ...categoryDto(existing), ...b, id: code });
    await this.assertLegible(t, [merged]);
    const row = await this.prisma.seatCategory.update({
      where: { id: existing.id },
      data: { label: merged.label, description: merged.description, shape: merged.shape, icon: merged.icon, colours: merged.colours ?? Prisma.JsonNull, sortOrder: merged.sortOrder },
    });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'seatCategory.update', entityType: 'SeatCategory', entityId: row.id, data: b });
    return categoryDto(row);
  }

  /** Categories used by any layout version (draft, published or retired) cannot be deleted. */
  @Delete('seat-categories/:code')
  @HttpCode(204)
  @Roles('OPERATOR_ADMIN')
  async deleteCategory(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('code') code: string) {
    const existing = await this.prisma.seatCategory.findUnique({ where: { tenantId_code: { tenantId: t.id, code } } });
    if (!existing) throw Errors.notFound('Seat category');
    // Every version counts: retired layouts can still have live screenings priced by this category.
    const layouts = await this.prisma.auditoriumLayoutVersion.findMany({ where: { auditorium: { tenantId: t.id } }, select: { geometry: true, auditorium: { select: { name: true } } } });
    const usedBy = layouts.filter((l) => (l.geometry as unknown as AuditoriumLayout).seats.some((s) => s.priceCategory === code));
    if (usedBy.length) throw Errors.validation(`This category is used by ${usedBy.length} auditorium layout(s), e.g. ${usedBy[0].auditorium.name}`);
    await this.prisma.$transaction([
      this.prisma.priceRule.deleteMany({ where: { tenantId: t.id, priceCategory: code } }),
      this.prisma.seatCategory.delete({ where: { id: existing.id } }),
    ]);
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'seatCategory.delete', entityType: 'SeatCategory', entityId: existing.id, data: { code } });
  }

  // ---------------- Ticket pricing ----------------

  @Get('pricing')
  async pricing(@CurrentTenant() t: Tenant) {
    const [types, categories, supplements, formats] = await Promise.all([
      this.prisma.ticketType.findMany({ where: { tenantId: t.id }, include: { priceRules: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.seatCategory.findMany({ where: { tenantId: t.id }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.formatSupplement.findMany({ where: { tenantId: t.id }, orderBy: { format: 'asc' } }),
      // Supplements match screening formats exactly, so the admin can flag typos.
      this.prisma.$queryRaw<{ format: string }[]>`SELECT DISTINCT unnest("formats") AS format FROM "Screening" WHERE "tenantId" = ${t.id} ORDER BY 1`,
    ]);
    return {
      currency: t.currency,
      bookingFeeMinor: t.bookingFeeMinor,
      categories: categories.map(categoryDto),
      ticketTypes: types.map((tt) => ({
        id: tt.id, code: tt.code, name: tt.name,
        prices: Object.fromEntries(categories.map((c) => [c.code, tt.priceRules.find((r) => r.priceCategory === c.code)?.amountMinor ?? null])),
      })),
      supplements: supplements.map((s) => ({ format: s.format, amountMinor: s.amountMinor })),
      knownFormats: formats.map((f) => f.format),
    };
  }

  /** Sets prices per ticket type × seat category. Null removes the price (not sold). */
  @Put('pricing')
  @Roles('OPERATOR_ADMIN')
  async setPricing(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(pricingBody)) b: z.infer<typeof pricingBody>) {
    const types = new Set((await this.prisma.ticketType.findMany({ where: { tenantId: t.id }, select: { id: true } })).map((x) => x.id));
    const cats = new Set((await this.prisma.seatCategory.findMany({ where: { tenantId: t.id }, select: { code: true } })).map((x) => x.code));
    const bad = b.prices.find((p) => !types.has(p.ticketTypeId) || !cats.has(p.priceCategory));
    if (bad) throw Errors.validation('Unknown ticket type or seat category');
    await this.prisma.$transaction(
      b.prices.map((p) =>
        p.amountMinor === null
          ? this.prisma.priceRule.deleteMany({ where: { ticketTypeId: p.ticketTypeId, priceCategory: p.priceCategory } })
          : this.prisma.priceRule.upsert({
              where: { ticketTypeId_priceCategory: { ticketTypeId: p.ticketTypeId, priceCategory: p.priceCategory } },
              create: { tenantId: t.id, ticketTypeId: p.ticketTypeId, priceCategory: p.priceCategory, amountMinor: p.amountMinor },
              update: { amountMinor: p.amountMinor },
            }),
      ),
    );
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'pricing.update', entityType: 'PriceRule', data: b });
    return this.pricing(t);
  }

  /**
   * Replaces the per-ticket booking fee and the full list of format supplements.
   * Formats left out are removed. New prices apply to quotes from now on; confirmed
   * bookings keep the totals they were charged.
   */
  @Put('pricing/fees')
  @Roles('OPERATOR_ADMIN')
  async setFees(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(feesBody)) b: z.infer<typeof feesBody>) {
    const before = await this.prisma.formatSupplement.findMany({ where: { tenantId: t.id } });
    await this.prisma.$transaction([
      this.prisma.tenant.update({ where: { id: t.id }, data: { bookingFeeMinor: b.bookingFeePerTicketMinor } }),
      this.prisma.formatSupplement.deleteMany({ where: { tenantId: t.id, format: { notIn: b.supplements.map((s) => s.format) } } }),
      ...b.supplements.map((s) =>
        this.prisma.formatSupplement.upsert({
          where: { tenantId_format: { tenantId: t.id, format: s.format } },
          create: { tenantId: t.id, format: s.format, amountMinor: s.amountMinor },
          update: { amountMinor: s.amountMinor },
        }),
      ),
    ]);
    // The fee lives on the tenant row, which is cached per instance for 30s.
    this.tenants.invalidate(t.slug);
    await this.audit.record({
      tenantId: t.id, actorId: a.sub, action: 'pricing.fees.update', entityType: 'Tenant', entityId: t.id,
      data: { before: { bookingFeePerTicketMinor: t.bookingFeeMinor, supplements: before.map((s) => ({ format: s.format, amountMinor: s.amountMinor })) }, after: b },
    });
    return this.pricing({ ...t, bookingFeeMinor: b.bookingFeePerTicketMinor });
  }

  // ---------------- Food and drink ----------------

  @Get('concessions')
  async concessions(@CurrentTenant() t: Tenant) {
    const rows = await this.prisma.concessionProduct.findMany({ where: { tenantId: t.id }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }] });
    return this.withImages(t, rows);
  }

  private async withImages<T extends { imageAssetId: string | null }>(t: Tenant, rows: T[]) {
    const ids = rows.map((r) => r.imageAssetId).filter((x): x is string => !!x);
    const assets = ids.length ? await this.prisma.mediaAsset.findMany({ where: { tenantId: t.id, id: { in: ids } } }) : [];
    return rows.map((r) => ({ ...r, image: imageRef(assets.find((a) => a.id === r.imageAssetId)) }));
  }

  private async assertProductImage(t: Tenant, imageAssetId: string | null | undefined) {
    if (!imageAssetId) return;
    const asset = await this.prisma.mediaAsset.findFirst({ where: { id: imageAssetId, tenantId: t.id } });
    if (!asset || asset.kind !== 'PRODUCT') throw Errors.validation('Choose an image uploaded for food and drink');
  }

  private async assertFilm(t: Tenant, filmId: string | null | undefined) {
    if (filmId && !(await this.prisma.film.findFirst({ where: { id: filmId, tenantId: t.id } }))) throw Errors.notFound('Film');
  }

  private async assertVenue(t: Tenant, venueId: string | null | undefined) {
    if (venueId && !(await this.prisma.venue.findFirst({ where: { id: venueId, tenantId: t.id } }))) throw Errors.notFound('Cinema');
  }

  @Post('concessions')
  @Roles('OPERATOR_ADMIN', 'VENUE_MANAGER')
  async createConcession(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(concessionBody)) b: z.infer<typeof concessionBody>) {
    await this.assertVenue(t, b.venueId);
    await this.assertProductImage(t, b.imageAssetId);
    await this.assertFilm(t, b.filmId);
    assertProductRules(b);
    const row = await this.prisma.concessionProduct
      .create({ data: { ...b, ...dates(b), tenantId: t.id, modifierGroups: b.modifierGroups as Prisma.InputJsonValue } })
      .catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw Errors.validation('A product with this SKU already exists');
        throw e;
      });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'concession.create', entityType: 'ConcessionProduct', entityId: row.id, data: b });
    return (await this.withImages(t, [row]))[0];
  }

  @Put('concessions/:id')
  @Roles('OPERATOR_ADMIN', 'VENUE_MANAGER')
  async updateConcession(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string, @Body(new ZodPipe(concessionBody.partial())) b: Partial<z.infer<typeof concessionBody>>) {
    const existing = await this.prisma.concessionProduct.findFirst({ where: { id, tenantId: t.id } });
    if (!existing) throw Errors.notFound('Product');
    await this.assertVenue(t, b.venueId);
    await this.assertProductImage(t, b.imageAssetId);
    await this.assertFilm(t, b.filmId);
    assertProductRules({ ...existing, ...b, ...dates(b) });
    const row = await this.prisma.concessionProduct.update({ where: { id }, data: { ...b, ...dates(b), modifierGroups: b.modifierGroups as Prisma.InputJsonValue | undefined } });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'concession.update', entityType: 'ConcessionProduct', entityId: id, data: b });
    return (await this.withImages(t, [row]))[0];
  }

  /** Products on past orders are kept (orders store names and prices), so deletion is safe. */
  @Delete('concessions/:id')
  @HttpCode(204)
  @Roles('OPERATOR_ADMIN', 'VENUE_MANAGER')
  async deleteConcession(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string) {
    const res = await this.prisma.concessionProduct.deleteMany({ where: { id, tenantId: t.id } });
    if (!res.count) throw Errors.notFound('Product');
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'concession.delete', entityType: 'ConcessionProduct', entityId: id });
  }

  // ---------------- Vouchers ----------------

  @Get('vouchers')
  async vouchers(@CurrentTenant() t: Tenant) {
    return this.prisma.voucher.findMany({ where: { tenantId: t.id }, orderBy: { code: 'asc' } });
  }

  @Post('vouchers')
  @Roles('OPERATOR_ADMIN')
  async createVoucher(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(voucherBody)) b: z.infer<typeof voucherBody>) {
    await this.assertVenue(t, b.venueId);
    const row = await this.prisma.voucher
      .create({ data: { ...b, tenantId: t.id, validFrom: b.validFrom ? new Date(b.validFrom) : null, validTo: b.validTo ? new Date(b.validTo) : null } })
      .catch((e) => {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw Errors.validation('A voucher with this code already exists');
        throw e;
      });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'voucher.create', entityType: 'Voucher', entityId: row.id, data: b });
    return row;
  }

  /** Codes and redemption counts are immutable; terms and the active flag can change. */
  @Put('vouchers/:id')
  @Roles('OPERATOR_ADMIN')
  async updateVoucher(
    @CurrentTenant() t: Tenant,
    @CurrentAdmin() a: AdminClaims,
    @Param('id') id: string,
    @Body(new ZodPipe(z.object({ description: z.string().min(1).max(100).optional(), active: z.boolean().optional(), validTo: z.string().datetime().nullable().optional(), maxRedemptions: z.number().int().min(1).nullable().optional(), venueId: z.string().nullable().optional() })))
    b: { description?: string; active?: boolean; validTo?: string | null; maxRedemptions?: number | null; venueId?: string | null },
  ) {
    const existing = await this.prisma.voucher.findFirst({ where: { id, tenantId: t.id } });
    if (!existing) throw Errors.notFound('Voucher');
    await this.assertVenue(t, b.venueId);
    if (b.maxRedemptions != null && b.maxRedemptions < existing.redemptions) throw Errors.validation(`Already redeemed ${existing.redemptions} times`);
    const row = await this.prisma.voucher.update({ where: { id }, data: { ...b, validTo: b.validTo === undefined ? undefined : b.validTo ? new Date(b.validTo) : null } });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'voucher.update', entityType: 'Voucher', entityId: id, data: b });
    return row;
  }
}
