import { z } from 'zod';
import { brandPaletteSchema, resolvedThemeSchema, THEME_IDS } from './theme';

/**
 * Runtime tenant configuration served to native apps.
 * Build-time identity (bundle ID, app icon, entitlements) is NOT part of this;
 * see docs/white-label.md.
 */

export const TENANT_CONFIG_SCHEMA_VERSION = 1;

export const featureFlagsSchema = z.object({
  memberships: z.boolean(),
  concessions: z.boolean(),
  wallet: z.boolean(),
  applePay: z.boolean(),
  liveActivities: z.boolean(),
  guestCheckout: z.boolean(),
});

export const homeSectionSchema = z.object({
  id: z.string(),
  kind: z.enum(['featured', 'nowShowing', 'comingSoon', 'upcomingBookings', 'promotion', 'collection']),
  title: z.string(),
  subtitle: z.string().optional(),
  collectionId: z.string().optional(),
});

export const tenantConfigSchema = z.object({
  schemaVersion: z.literal(TENANT_CONFIG_SCHEMA_VERSION),
  /** Monotonic published configuration version. */
  version: z.number().int().positive(),
  publishedAt: z.string(),
  tenant: z.object({
    id: z.string(),
    slug: z.string(),
    name: z.string(),
    locale: z.string(),
    currency: z.string().length(3),
    timeZone: z.string(),
  }),
  branding: z.object({
    logoLightUrl: z.string().nullable(),
    logoDarkUrl: z.string().nullable(),
    markUrl: z.string().nullable(),
    wordmark: z.string(),
    palette: brandPaletteSchema,
  }),
  theme: resolvedThemeSchema,
  availableThemes: z.array(z.enum(THEME_IDS)),
  /**
   * Resolved tokens for the other themes the operator offers, so customers can
   * switch theme (or the app can honour Increase Contrast) without a release.
   */
  alternateThemes: z.array(resolvedThemeSchema).default([]),
  features: featureFlagsSchema,
  home: z.array(homeSectionSchema),
  support: z.object({ email: z.string(), phone: z.string().nullable(), url: z.string().nullable() }),
  legal: z.object({ termsUrl: z.string(), privacyUrl: z.string(), companyName: z.string() }),
  booking: z.object({
    maxTicketsPerBooking: z.number().int().positive(),
    holdDurationSeconds: z.number().int().positive(),
  }),
});
export type TenantConfig = z.infer<typeof tenantConfigSchema>;
export type FeatureFlags = z.infer<typeof featureFlagsSchema>;
export type HomeSection = z.infer<typeof homeSectionSchema>;
