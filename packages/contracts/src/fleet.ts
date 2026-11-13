import { z } from 'zod';

/**
 * The fleet: every operator app built from this one codebase.
 *
 * One brand file per app lives in `fleet/brands/<slug>.json`, and one policy file
 * (`fleet/policy.json`) says which app versions are current and which are too old.
 * The release workflow, the backend and the iOS app all read these shapes.
 */

const slug = z.string().regex(/^[a-z][a-z0-9-]{1,30}$/, 'lower-case letters, digits and hyphens');
export const AppVersionString = z.string().regex(/^\d+\.\d+(\.\d+)?$/, 'a version like 1.4 or 1.4.2');

/** Release rings, in the order a new version reaches them. */
export const RINGS = ['internal', 'pilot', 'general'] as const;
export const Ring = z.enum(RINGS);
export type Ring = z.infer<typeof Ring>;

export const BrandManifest = z
  .object({
    /** Tenant slug the app talks to (`/v1/t/{slug}`). */
    slug,
    /** Name under the icon on the home screen. */
    appName: z.string().min(1).max(30),
    /** App Store name: unique across the whole App Store. */
    storeName: z.string().min(1).max(30),
    bundleId: z.string().regex(/^[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)+$/),
    /**
     * Apple Developer team the app is published under. Apple guideline 4.2.6 means this is
     * the operator's own team for a live app; our own team only for demos.
     */
    appleTeamId: z.string().regex(/^[A-Z0-9]{10}$/),
    /** Numeric App Store ID once the app record exists, for update links. */
    appStoreId: z.string().regex(/^\d+$/).nullable(),
    /** Asset catalogue icon name (an .appiconset, or an Icon Composer .icon file). */
    appIcon: z.string().min(1),
    ring: Ring,
    /** live: ships with every release; paused: skipped (contract ended, app frozen). */
    status: z.enum(['live', 'paused']),
    /**
     * Suffix of the GitHub secrets holding the App Store Connect key for this brand's Apple team:
     * ASC_KEY_ID_<suffix>, ASC_ISSUER_ID_<suffix>, ASC_PRIVATE_KEY_<suffix>. Brands on the same team share it.
     */
    secretSuffix: z.string().regex(/^[A-Z][A-Z0-9_]*$/),
    /** Builds that run on bundled fictional data, for sales demos. */
    demoMode: z.boolean().default(false),
  })
  .strict();
export type BrandManifest = z.infer<typeof BrandManifest>;

const PlatformPolicy = z
  .object({
    /** Below this the app stops and asks the customer to update (it would break against the API). */
    minimumVersion: AppVersionString,
    /** The newest released version; anything older is offered the update once. */
    latestVersion: AppVersionString,
    /** Shown on the update prompt, in plain words. */
    message: z.string().max(200).optional(),
  })
  .strict()
  .refine((p) => compareVersions(p.minimumVersion, p.latestVersion) <= 0, 'minimumVersion cannot be above latestVersion');

export const FleetPolicy = z
  .object({
    ios: PlatformPolicy,
    /** Per-brand exceptions, e.g. a brand still in review on the new version keeps an older latestVersion. */
    overrides: z.record(slug, z.object({ ios: PlatformPolicy }).strict()).default({}),
  })
  .strict();
export type FleetPolicy = z.infer<typeof FleetPolicy>;

export const AppStatus = z.object({
  status: z.enum(['current', 'update-available', 'update-required']),
  latestVersion: AppVersionString,
  minimumVersion: AppVersionString,
  message: z.string().nullable(),
  /** App Store page for this brand, when the app is in the store. */
  storeUrl: z.string().url().nullable(),
});
export type AppStatus = z.infer<typeof AppStatus>;

/** -1, 0 or 1. Missing parts count as zero, so 1.4 equals 1.4.0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/** What a given app version should do, for one brand. The server decides; the app only shows it. */
export function appStatus(policy: FleetPolicy, brand: Pick<BrandManifest, 'slug' | 'appStoreId'> | null, version: string): AppStatus {
  const p = (brand && policy.overrides[brand.slug]?.ios) || policy.ios;
  const valid = AppVersionString.safeParse(version).success;
  const status = !valid || compareVersions(version, p.minimumVersion) < 0 ? 'update-required' : compareVersions(version, p.latestVersion) < 0 ? 'update-available' : 'current';
  return {
    status,
    latestVersion: p.latestVersion,
    minimumVersion: p.minimumVersion,
    message: status === 'current' ? null : p.message ?? null,
    storeUrl: brand?.appStoreId ? `https://apps.apple.com/app/id${brand.appStoreId}` : null,
  };
}

/** Brands a release reaches when it is sent to `ring`: that ring and every earlier one. */
export function brandsForRing(brands: BrandManifest[], ring: Ring): BrandManifest[] {
  const upTo = RINGS.indexOf(ring);
  return brands.filter((b) => b.status === 'live' && RINGS.indexOf(b.ring) <= upTo).sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Problems across the whole fleet that a single brand file can't show. */
export function fleetProblems(brands: BrandManifest[], policy: FleetPolicy, fileSlugs: string[] = brands.map((b) => b.slug)): string[] {
  const out: string[] = [];
  const dup = <K extends keyof BrandManifest>(k: K) => {
    const seen = new Map<unknown, string>();
    for (const b of brands) {
      const v = b[k];
      if (v == null) continue;
      if (seen.has(v)) out.push(`${String(k)} "${String(v)}" is used by both ${seen.get(v)} and ${b.slug}`);
      else seen.set(v, b.slug);
    }
  };
  dup('slug');
  dup('bundleId');
  dup('storeName');
  dup('appStoreId');
  brands.forEach((b, i) => {
    if (fileSlugs[i] !== b.slug) out.push(`brand file ${fileSlugs[i]}.json has slug "${b.slug}"; name the file after the slug`);
  });
  for (const s of Object.keys(policy.overrides)) if (!brands.some((b) => b.slug === s)) out.push(`policy override for unknown brand "${s}"`);
  return out;
}

/** The xcconfig that gives a build its brand. Shared settings come from Base.xcconfig. */
export function xcconfigFor(b: BrandManifest): string {
  return [
    '#include "Base.xcconfig"',
    `// Generated from fleet/brands/${b.slug}.json by scripts/fleet.mjs. Edit the brand file, not this.`,
    `APP_BUNDLE_ID = ${b.bundleId}`,
    `APP_NAME = ${b.appName}`,
    `TENANT_SLUG = ${b.slug}`,
    `DEVELOPMENT_TEAM = ${b.appleTeamId}`,
    `ASSETCATALOG_COMPILER_APPICON_NAME = ${b.appIcon}`,
    `DEMO_MODE = ${b.demoMode ? 'YES' : 'NO'}`,
    '',
  ].join('\n');
}
