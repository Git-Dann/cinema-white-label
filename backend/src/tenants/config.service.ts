import { Injectable } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { BrandPalette as PaletteRow, Prisma, Tenant } from '@prisma/client';
import {
  appearancePolicySchema,
  BrandPalette,
  featureFlagsSchema,
  homeSectionSchema,
  resolveTheme,
  TENANT_CONFIG_SCHEMA_VERSION,
  TenantConfig,
  tenantConfigSchema,
  THEME_IDS,
  validateThemeContrast,
} from '@cinema/contracts';
import { z } from 'zod';
import { Clock } from '../common/clock';
import { AuditService } from '../common/common.module';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';

export const draftSchema = z.object({
  themeId: z.enum(THEME_IDS),
  paletteId: z.string(),
  appearancePolicy: appearancePolicySchema.nullable().default(null),
  availableThemes: z.array(z.enum(THEME_IDS)).min(1),
  wordmark: z.string().min(1).max(40),
  logoLightAssetId: z.string().nullable().default(null),
  logoDarkAssetId: z.string().nullable().default(null),
  markAssetId: z.string().nullable().default(null),
  features: featureFlagsSchema,
  home: z.array(homeSectionSchema),
  support: z.object({ email: z.string().email(), phone: z.string().nullable(), url: z.string().nullable() }),
  legal: z.object({ termsUrl: z.string(), privacyUrl: z.string(), companyName: z.string() }),
});
export type TenantDraft = z.infer<typeof draftSchema>;

export function paletteFromRow(p: PaletteRow): BrandPalette {
  return { id: p.id, name: p.name, accent: { light: p.accentLight, dark: p.accentDark }, secondary: { light: p.secondaryLight, dark: p.secondaryDark } };
}

const mediaUrl = (id: string | null) => (id ? `/v1/media/${id}` : null);

export interface ValidationReport {
  ok: boolean;
  issues: { kind: 'contrast' | 'schema' | 'palette'; message: string; appearance?: string; ratio?: number; required?: number }[];
}

@Injectable()
export class ConfigService {
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock, private readonly audit: AuditService) {}

  async getDraft(tenantId: string): Promise<TenantDraft> {
    const s = await this.prisma.tenantSettings.findUnique({ where: { tenantId } });
    if (!s) throw Errors.notFound('Tenant settings');
    return draftSchema.parse(s.draft);
  }

  async updateDraft(tenant: Tenant, patch: Partial<TenantDraft>, actorId: string): Promise<TenantDraft> {
    const current = await this.getDraft(tenant.id);
    const next = draftSchema.parse({ ...current, ...patch });
    if (!next.availableThemes.includes(next.themeId)) next.availableThemes = [next.themeId, ...next.availableThemes];
    await this.prisma.tenantSettings.update({ where: { tenantId: tenant.id }, data: { draft: next as unknown as Prisma.InputJsonValue } });
    await this.audit.record({ tenantId: tenant.id, actorId, action: 'draft.update', entityType: 'TenantSettings', entityId: tenant.id, data: patch });
    return next;
  }

  /** Builds the app-facing configuration from a draft. Pure apart from palette lookup. */
  async compose(tenant: Tenant, draft: TenantDraft, version: number, paletteOverride?: BrandPalette): Promise<{ config: TenantConfig; report: ValidationReport }> {
    const issues: ValidationReport['issues'] = [];
    let palette = paletteOverride;
    if (!palette) {
      const row = await this.prisma.brandPalette.findFirst({ where: { id: draft.paletteId, tenantId: tenant.id } });
      if (!row) throw Errors.validation('Palette not found');
      if (!row.approved) issues.push({ kind: 'palette', message: `Palette "${row.name}" has not been approved` });
      palette = paletteFromRow(row);
    }
    const theme = resolveTheme(draft.themeId, palette, draft.appearancePolicy ? { appearancePolicy: draft.appearancePolicy } : undefined);
    const alternateThemes = draft.availableThemes.filter((id) => id !== draft.themeId).map((id) => resolveTheme(id, palette!));
    for (const t of [theme, ...alternateThemes]) {
      for (const c of validateThemeContrast(t)) {
        issues.push({ kind: 'contrast', message: `${t.name}: ${c.label} (${c.appearance}) is ${c.ratio}:1, needs ${c.required}:1`, appearance: c.appearance, ratio: c.ratio, required: c.required });
      }
    }
    const config: TenantConfig = {
      schemaVersion: TENANT_CONFIG_SCHEMA_VERSION,
      version,
      publishedAt: this.clock.now().toISOString(),
      tenant: { id: tenant.id, slug: tenant.slug, name: tenant.name, locale: tenant.locale, currency: tenant.currency, timeZone: tenant.timeZone },
      branding: { logoLightUrl: mediaUrl(draft.logoLightAssetId), logoDarkUrl: mediaUrl(draft.logoDarkAssetId), markUrl: mediaUrl(draft.markAssetId), wordmark: draft.wordmark, palette },
      theme,
      availableThemes: draft.availableThemes,
      alternateThemes,
      features: draft.features,
      home: draft.home,
      support: draft.support,
      legal: draft.legal,
      booking: { maxTicketsPerBooking: tenant.maxTicketsPerBooking, holdDurationSeconds: tenant.holdDurationSeconds },
    };
    const parsed = tenantConfigSchema.safeParse(config);
    if (!parsed.success) for (const i of parsed.error.issues) issues.push({ kind: 'schema', message: `${i.path.join('.')}: ${i.message}` });
    return { config, report: { ok: issues.length === 0, issues } };
  }

  async preview(tenant: Tenant, patch: Partial<TenantDraft>, palette?: BrandPalette) {
    const draft = draftSchema.parse({ ...(await this.getDraft(tenant.id)), ...patch });
    return this.compose(tenant, draft, 1, palette);
  }

  /** Validates and publishes the current draft, optionally scheduled for later. */
  async publish(tenant: Tenant, actorId: string | null, opts: { note?: string; scheduledFor?: Date } = {}) {
    const draft = await this.getDraft(tenant.id);
    return this.prisma.$transaction(async (tx) => {
      // Serialise publishes per tenant so version numbers stay monotonic.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'release:' + tenant.id}))`;
      const last = await tx.configRelease.findFirst({ where: { tenantId: tenant.id }, orderBy: { version: 'desc' } });
      const version = (last?.version ?? 0) + 1;
      const { config, report } = await this.compose(tenant, draft, version);
      if (!report.ok) throw Errors.publishBlocked(report.issues);
      const scheduled = opts.scheduledFor && opts.scheduledFor > this.clock.now();
      const release = await tx.configRelease.create({
        data: {
          tenantId: tenant.id,
          version,
          status: scheduled ? 'SCHEDULED' : 'PUBLISHED',
          snapshot: config as unknown as Prisma.InputJsonValue,
          note: opts.note ?? null,
          scheduledFor: scheduled ? opts.scheduledFor : null,
          publishedAt: scheduled ? null : this.clock.now(),
          createdById: actorId,
        },
      });
      if (!scheduled) {
        await tx.configRelease.updateMany({ where: { tenantId: tenant.id, status: 'PUBLISHED', version: { lt: version } }, data: { status: 'SUPERSEDED' } });
        // An immediate publish supersedes anything still waiting to go live.
        await tx.configRelease.updateMany({ where: { tenantId: tenant.id, status: 'SCHEDULED', version: { lt: version } }, data: { status: 'CANCELLED' } });
      }
      await tx.auditLog.create({ data: { tenantId: tenant.id, actorId, action: scheduled ? 'release.schedule' : 'release.publish', entityType: 'ConfigRelease', entityId: release.id, data: { version, note: opts.note ?? null } } });
      return release;
    });
  }

  /** Re-publishes an earlier snapshot as a new version (history is never rewritten). */
  async rollback(tenant: Tenant, toVersion: number, actorId: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'release:' + tenant.id}))`;
      const target = await tx.configRelease.findUnique({ where: { tenantId_version: { tenantId: tenant.id, version: toVersion } } });
      if (!target) throw Errors.notFound('Release');
      if (target.status !== 'PUBLISHED' && target.status !== 'SUPERSEDED') throw Errors.validation('Only releases that have been live can be restored');
      const last = await tx.configRelease.findFirst({ where: { tenantId: tenant.id }, orderBy: { version: 'desc' } });
      const version = (last?.version ?? 0) + 1;
      const snapshot = { ...(target.snapshot as unknown as TenantConfig), version, publishedAt: this.clock.now().toISOString() };
      const release = await tx.configRelease.create({
        data: { tenantId: tenant.id, version, status: 'PUBLISHED', snapshot: snapshot as unknown as Prisma.InputJsonValue, note: `Rollback to v${toVersion}`, publishedAt: this.clock.now(), createdById: actorId },
      });
      await tx.configRelease.updateMany({ where: { tenantId: tenant.id, status: 'PUBLISHED', version: { lt: version } }, data: { status: 'SUPERSEDED' } });
      await tx.configRelease.updateMany({ where: { tenantId: tenant.id, status: 'SCHEDULED', version: { lt: version } }, data: { status: 'CANCELLED' } });
      await tx.auditLog.create({ data: { tenantId: tenant.id, actorId, action: 'release.rollback', entityType: 'ConfigRelease', entityId: release.id, data: { from: last?.version, to: toVersion, newVersion: version } } });
      return release;
    });
  }

  /** The configuration currently live for customers. Promotes due scheduled releases first. */
  async current(tenantId: string): Promise<TenantConfig> {
    await this.promoteDue(tenantId);
    const r = await this.prisma.configRelease.findFirst({ where: { tenantId, status: 'PUBLISHED' }, orderBy: { version: 'desc' } });
    if (!r) throw Errors.notFound('Published configuration');
    return r.snapshot as unknown as TenantConfig;
  }

  async promoteDue(tenantId?: string) {
    const due = await this.prisma.configRelease.findMany({
      where: { status: 'SCHEDULED', scheduledFor: { lte: this.clock.now() }, ...(tenantId ? { tenantId } : {}) },
      orderBy: { version: 'asc' },
    });
    for (const r of due) {
      await this.prisma.$transaction([
        this.prisma.configRelease.updateMany({ where: { tenantId: r.tenantId, status: 'PUBLISHED', version: { lt: r.version } }, data: { status: 'SUPERSEDED' } }),
        this.prisma.configRelease.update({ where: { id: r.id }, data: { status: 'PUBLISHED', publishedAt: this.clock.now() } }),
      ]);
    }
  }

  @Interval(30_000)
  async promoteScheduledReleases() {
    await this.promoteDue();
  }
}
