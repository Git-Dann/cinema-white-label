import { describe, expect, it } from 'vitest';
import { appStatus, BrandManifest, brandsForRing, compareVersions, FleetPolicy, fleetProblems, xcconfigFor } from './index';

const brand = (slug: string, over: Partial<BrandManifest> = {}): BrandManifest =>
  BrandManifest.parse({
    slug,
    appName: slug,
    storeName: `${slug} Cinema`,
    bundleId: `uk.example.${slug}`,
    appleTeamId: 'ABCDE12345',
    appStoreId: null,
    appIcon: 'AppIcon',
    ring: 'general',
    status: 'live',
    secretSuffix: slug.toUpperCase(),
    ...over,
  });

const policy = FleetPolicy.parse({ ios: { minimumVersion: '1.2', latestVersion: '1.4.0', message: 'This version adds Apple Pay.' } });

describe('fleet versions', () => {
  it('compares versions numerically, not as text', () => {
    expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
    expect(compareVersions('1.4', '1.4.0')).toBe(0);
    expect(compareVersions('0.9', '1.0')).toBe(-1);
  });

  it('tells an app whether it is current, can update or must update', () => {
    const b = brand('northlight', { appStoreId: '123456789' });
    expect(appStatus(policy, b, '1.4.0')).toMatchObject({ status: 'current', message: null, storeUrl: 'https://apps.apple.com/app/id123456789' });
    expect(appStatus(policy, b, '1.5.0').status).toBe('current');
    expect(appStatus(policy, b, '1.3.9')).toMatchObject({ status: 'update-available', message: 'This version adds Apple Pay.' });
    expect(appStatus(policy, b, '1.1.0').status).toBe('update-required');
    // A version the server can't read is treated as too old rather than waved through.
    expect(appStatus(policy, b, 'banana').status).toBe('update-required');
    expect(appStatus(policy, null, '1.4.0').storeUrl).toBeNull();
  });

  it('lets one brand lag behind while its new version is in review', () => {
    const p = FleetPolicy.parse({ ...policy, overrides: { kestrel: { ios: { minimumVersion: '1.2', latestVersion: '1.3' } } } });
    expect(appStatus(p, brand('kestrel'), '1.3').status).toBe('current');
    expect(appStatus(p, brand('northlight'), '1.3').status).toBe('update-available');
  });

  it('rejects a policy whose minimum is above its latest version', () => {
    expect(FleetPolicy.safeParse({ ios: { minimumVersion: '2.0', latestVersion: '1.9' } }).success).toBe(false);
  });
});

describe('fleet brands', () => {
  it('sends a release to its ring and every earlier ring, skipping paused apps', () => {
    const all = [brand('aa', { ring: 'internal' }), brand('bb', { ring: 'pilot' }), brand('cc'), brand('dd', { status: 'paused', ring: 'internal' })];
    expect(brandsForRing(all, 'internal').map((b) => b.slug)).toEqual(['aa']);
    expect(brandsForRing(all, 'pilot').map((b) => b.slug)).toEqual(['aa', 'bb']);
    expect(brandsForRing(all, 'general').map((b) => b.slug)).toEqual(['aa', 'bb', 'cc']);
  });

  it('finds clashes no single brand file can show', () => {
    const problems = fleetProblems([brand('aa'), brand('bb', { bundleId: 'uk.example.aa', secretSuffix: 'AA' }), brand('cc', { appStoreId: '42' }), brand('dd', { appStoreId: '42' })], FleetPolicy.parse({ ...policy, overrides: { zzz: { ios: policy.ios } } }), ['aa', 'bee', 'cc', 'dd']);
    expect(problems).toEqual([
      'bundleId "uk.example.aa" is used by both aa and bb',
      'appStoreId "42" is used by both cc and dd',
      'brand file bee.json has slug "bb"; name the file after the slug',
      'policy override for unknown brand "zzz"',
    ]);
    expect(fleetProblems([brand('aa'), brand('bb')], policy)).toEqual([]);
  });

  it('rejects brand files with unknown or malformed fields', () => {
    expect(BrandManifest.safeParse({ ...brand('aa'), colour: 'red' }).success).toBe(false);
    expect(BrandManifest.safeParse({ ...brand('aa'), appleTeamId: 'short' }).success).toBe(false);
  });

  it('writes the xcconfig that brands a build', () => {
    const x = xcconfigFor(brand('kestrel', { appIcon: 'AppIcon-Kestrel', demoMode: true }));
    expect(x).toContain('#include "Base.xcconfig"');
    expect(x).toContain('APP_BUNDLE_ID = uk.example.kestrel');
    expect(x).toContain('DEVELOPMENT_TEAM = ABCDE12345');
    expect(x).toContain('ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon-Kestrel');
    expect(x).toContain('DEMO_MODE = YES');
  });
});
