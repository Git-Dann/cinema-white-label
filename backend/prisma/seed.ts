/**
 * Development seed. Wipes and recreates two fictional operators with venues,
 * auditoriums, films, artwork, pricing, a week of screenings and a published
 * tenant configuration. Safe to run repeatedly.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { AuditoriumLayout, validateLayout } from '@cinema/contracts';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { FixtureFilmProvider } from '../src/catalogue/providers/adapters';
import { resolveFilms } from '../src/catalogue/providers/resolver';
import { Clock } from '../src/common/clock';
import { AuditService } from '../src/common/common.module';
import { PrismaService } from '../src/common/prisma.service';
import { zonedToUtc, zonedDate } from '../src/common/time';
import { hashPassword } from '../src/common/tokens';
import { MEDIA_ROOTS } from '../src/media/media.module';
import { ConfigService, TenantDraft } from '../src/tenants/config.service';
import { FILMS } from '../src/fixtures/films';
import { curvedLayout, luxeLayout, premiereLayout, standardLayout } from '../src/fixtures/layouts';
import { CONCESSIONS, VOUCHERS } from '../src/fixtures/commerce';
import { ensureFixtureProductImages } from '../src/fixtures/product-images';
import { ensureFixtureVenueImages } from '../src/fixtures/venue-images';
import { ensureFixturePromotionImages } from '../src/fixtures/promotion-images';
import { DEMO_TENANTS, ensureDemoHistory } from '../src/intelligence/outcomes';
import { ensureDemoInterest } from '../src/intelligence/interest';
import { ensureDemoConversation } from '../src/intelligence/conversation';
import { SLOT_BASE } from '../src/intelligence/pulse';
import { ensureFixtureMenuSpecials, fixtureProductData } from '../src/fixtures/menu-specials';
import { DEFAULT_SEAT_CATEGORIES } from '@cinema/contracts';
import { TENANTS } from '../src/fixtures/tenants';

// Local convenience only: CI and production provide environment variables directly.
if (existsSync(join(__dirname, '../.env'))) process.loadEnvFile?.(join(__dirname, '../.env'));

const prisma = new PrismaService();
const SHOW_TIMES = ['12:30', '15:20', '18:10', '20:50'];
const DAYS = 7;

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

async function dominantColour(file: string): Promise<string> {
  const { dominant: d } = await sharp(file).stats();
  return `#${[d.r, d.g, d.b].map((x) => x.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

const LAYOUT_BUILDERS = { standard: standardLayout, curved: curvedLayout, luxe: luxeLayout, premiere: premiereLayout };

async function main() {
  const now = new Date();
  console.log('Clearing existing data…');
  await prisma.idempotencyRecord.deleteMany();
  await prisma.analyticsEvent.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.promotion.deleteMany();
  await prisma.loyaltyLedgerEntry.deleteMany();
  await prisma.loyaltyAccount.deleteMany();
  await prisma.adminUser.deleteMany();
  await prisma.tenant.deleteMany();

  await prisma.adminUser.create({
    data: { email: 'platform@cinema.example', name: 'Platform Admin', role: 'PLATFORM_ADMIN', passwordHash: hashPassword('platform-dev-password') },
  });

  const config = new ConfigService(prisma, new Clock(), new AuditService(prisma));
  const fixtureProvider = new FixtureFilmProvider(now);

  for (const t of TENANTS) {
    console.log(`Seeding ${t.name}…`);
    const tenant = await prisma.tenant.create({
      data: { slug: t.slug, name: t.name, bookingFeeMinor: t.bookingFeeMinor, maxTicketsPerBooking: 10, holdDurationSeconds: 480, orphanSeatPolicy: 'warn', companionPolicy: t.companionPolicy, cancellationCutoffMinutes: 60 },
    });
    const palette = await prisma.brandPalette.create({
      data: { tenantId: tenant.id, name: t.palette.name, accentLight: t.palette.accent.light, accentDark: t.palette.accent.dark, secondaryLight: t.palette.secondary.light, secondaryDark: t.palette.secondary.dark, approved: true },
    });
    for (const p of t.extraPalettes) {
      await prisma.brandPalette.create({
        data: { tenantId: tenant.id, name: p.name, accentLight: p.accent.light, accentDark: p.accent.dark, secondaryLight: p.secondary.light, secondaryDark: p.secondary.dark, approved: true },
      });
    }

    const logoAsset = async (mode: 'light' | 'dark') =>
      prisma.mediaAsset.create({
        data: {
          tenantId: tenant.id, kind: 'LOGO', provider: 'fixture', sourceRef: `fixture://${t.slug}-logo-${mode}.png`, storageKey: `fixture/${t.slug}-logo-${mode}.png`,
          width: 900, height: 240, mimeType: 'image/png', licenceRef: 'internal-development-fixture', approvedContexts: ['branding'],
        },
      });
    const [logoLight, logoDark] = [await logoAsset('light'), await logoAsset('dark')];

    const draft: TenantDraft = {
      themeId: t.theme,
      paletteId: palette.id,
      appearancePolicy: null,
      availableThemes: t.availableThemes,
      wordmark: t.wordmark,
      logoLightAssetId: logoLight.id,
      logoDarkAssetId: logoDark.id,
      markAssetId: null,
      splashAssetId: null,
      typography: t.slug === 'kestrel' ? { design: 'serif', headingWeight: 'bold' } : { design: 'default', headingWeight: 'heavy' },
      features: { memberships: t.slug === 'northlight', concessions: true, wallet: true, applePay: false, liveActivities: false, guestCheckout: true },
      home: [
        { id: 'featured', kind: 'featured', title: 'Featured', subtitle: 'Big screen picks this week' },
        { id: 'offers', kind: 'promotion', title: 'Offers' },
        { id: 'upcoming', kind: 'upcomingBookings', title: 'Your Tickets' },
        { id: 'now', kind: 'nowShowing', title: 'Now Showing', subtitle: 'In cinemas now' },
        { id: 'soon', kind: 'comingSoon', title: 'Coming Soon', subtitle: 'Book ahead for opening week' },
      ],
      support: t.support,
      legal: { termsUrl: `https://${t.slug}.example/terms`, privacyUrl: `https://${t.slug}.example/privacy`, companyName: `${t.name} Ltd (fictional)` },
    };
    await prisma.tenantSettings.create({ data: { tenantId: tenant.id, draft: draft as unknown as Prisma.InputJsonValue } });

    await prisma.adminUser.create({
      data: { email: `admin@${t.slug}.example`, name: `${t.name} Admin`, role: 'OPERATOR_ADMIN', tenantId: tenant.id, passwordHash: hashPassword('operator-dev-password') },
    });
    await prisma.adminUser.create({
      data: { email: `editor@${t.slug}.example`, name: `${t.name} Editor`, role: 'CONTENT_EDITOR', tenantId: tenant.id, passwordHash: hashPassword('editor-dev-password') },
    });

    // Seat categories (Kestrel uses its own premium colours to show operator theming).
    for (const c of DEFAULT_SEAT_CATEGORIES) {
      const colours = t.slug === 'kestrel' && c.id === 'premium'
        ? { light: { fill: '#F6EBD9', accent: '#8A6A12' }, dark: { fill: '#2A2116', accent: '#D4AF37' } }
        : c.colours;
      await prisma.seatCategory.create({
        data: { tenantId: tenant.id, code: c.id, label: c.label, description: c.description, shape: c.shape, icon: c.icon, colours: colours ?? Prisma.JsonNull, sortOrder: c.sortOrder },
      });
    }
    for (const [i, c] of CONCESSIONS.entries()) {
      await prisma.concessionProduct.create({ data: fixtureProductData(tenant.id, c, i, null) });
    }
    for (const v of VOUCHERS) await prisma.voucher.create({ data: { tenantId: tenant.id, ...v } });

    // Loyalty and memberships (Northlight only, so Kestrel shows the app without them).
    if (t.slug === 'northlight') {
      await prisma.loyaltyProgram.create({ data: { tenantId: tenant.id, name: 'Northlight Rewards', earnPointsPerPound: 10, redeemPointsPerPound: 200, minRedeemPoints: 200 } });
      await prisma.membershipPlan.createMany({
        data: [
          { tenantId: tenant.id, name: 'Northlight Plus', description: '10% off tickets and food, no booking fees, 1.5× points.', priceMinor: 699, interval: 'month', sortOrder: 0,
            entitlements: { ticketDiscountPercent: 10, foodDiscountPercent: 10, bookingFeeWaived: true, pointsMultiplier: 1.5 } },
          { tenantId: tenant.id, name: 'Northlight Premiere', description: '25% off tickets, 15% off food, no booking fees, double points.', priceMinor: 1499, interval: 'month', sortOrder: 1,
            entitlements: { ticketDiscountPercent: 25, foodDiscountPercent: 15, bookingFeeWaived: true, pointsMultiplier: 2 } },
        ],
      });
    }

    // Pricing
    const ticketMeta: Record<string, { name: string; description: string; requiresProof: boolean; sortOrder: number }> = {
      ADULT: { name: 'Adult', description: 'Ages 15 and over', requiresProof: false, sortOrder: 0 },
      CHILD: { name: 'Child', description: 'Ages 3 to 14', requiresProof: false, sortOrder: 1 },
      CONCESSION: { name: 'Student / Senior', description: 'Valid ID may be requested', requiresProof: true, sortOrder: 2 },
    };
    for (const [code, prices] of Object.entries(t.prices)) {
      const tt = await prisma.ticketType.create({ data: { tenantId: tenant.id, code, ...ticketMeta[code] } });
      await prisma.priceRule.createMany({ data: Object.entries(prices).map(([priceCategory, amountMinor]) => ({ tenantId: tenant.id, ticketTypeId: tt.id, priceCategory, amountMinor })) });
    }
    await prisma.formatSupplement.createMany({ data: Object.entries(t.formatSupplements).map(([format, amountMinor]) => ({ tenantId: tenant.id, format, amountMinor })) });

    // Films via the provider resolver (same path a real ingestion uses).
    const { resolved, review } = resolveFilms(await fixtureProvider.fetchFilms(), [], ['operator', 'licensed', 'enrichment', 'fixture']);
    if (review.length) throw new Error('Fixture films should not need review');
    const films: { id: string; slug: string; released: boolean; formats: string[][] }[] = [];
    for (const r of resolved) {
      const f = r.fields;
      const fx = FILMS.find((x) => x.slug === r.externalIds[0].externalId)!;
      const film = await prisma.film.create({
        data: {
          tenantId: tenant.id, slug: fx.slug, title: f.title!, tagline: f.tagline ?? null, synopsis: f.synopsis!, releaseDate: new Date(`${f.releaseDate}T00:00:00Z`),
          runtimeMinutes: f.runtimeMinutes!, certificate: f.certificate!, genres: f.genres ?? [], director: f.director ?? null, cast: f.cast ?? [],
          originalLanguage: f.originalLanguage ?? 'en', provenance: r.provenance as Prisma.InputJsonValue,
          externalIds: { create: r.externalIds.map((e) => ({ tenantId: tenant.id, ...e })) },
          trailers: { create: [{ title: 'Official Trailer', kind: 'trailer', provider: 'fixture', durationSeconds: 140, url: null }, { title: 'First Look', kind: 'teaser', provider: 'fixture', durationSeconds: 62, url: null }] },
        },
      });
      for (const a of r.records[0].assets) {
        const file = a.sourceRef.replace('fixture://', '');
        await prisma.mediaAsset.create({
          data: {
            tenantId: tenant.id, filmId: film.id, kind: a.kind, provider: 'fixture', sourceRef: a.sourceRef, storageKey: `fixture/${file}`,
            licenceRef: a.licenceRef, attribution: a.attribution, usageRestrictions: a.usageRestrictions, width: a.width, height: a.height, mimeType: a.mimeType,
            dominantColor: await dominantColour(join(MEDIA_ROOTS.fixture, file)), focalX: 0.5, focalY: a.kind === 'BACKDROP' ? 0.4 : 0.5,
            isPreferred: true, approvedContexts: a.kind === 'POSTER' ? ['list', 'detail', 'wallet'] : ['detail', 'hero'],
          },
        });
      }
      films.push({ id: film.id, slug: fx.slug, released: fx.releaseOffsetDays <= 0, formats: fx.formats });
    }

    // Venues, auditoriums, layouts, screenings
    const showing = films.filter((f) => f.released);
    const upcoming = films.filter((f) => !f.released);

    // Promotions for the home screen (fictional offers).
    await prisma.promotion.createMany({
      data: [
        { tenantId: tenant.id, title: 'New here? 10% off', body: 'Use code WELCOME10 on your first booking, tickets and food included.', ctaLabel: 'Show code', action: 'voucher', voucherCode: 'WELCOME10', sortOrder: 0 },
        { tenantId: tenant.id, title: 'Opening night, booked early', body: 'Tickets for the next big release are on sale now. Pick your seats before they go.', ctaLabel: 'See the film', action: 'film', filmId: (upcoming[0] ?? showing[0]).id, sortOrder: 1 },
      ],
    });
    const random = rng(t.slug.length * 7919);
    let screeningCount = 0;
    for (const [vi, v] of t.venues.entries()) {
      const venue = await prisma.venue.create({
        data: { tenantId: tenant.id, slug: v.slug, name: v.name, addressLine1: v.addressLine1, city: v.city, postcode: v.postcode, latitude: v.latitude, longitude: v.longitude, facilities: v.facilities, phone: null, features: v.features ?? {} },
      });
      for (const [ai, kind] of v.layouts.entries()) {
        const layout: AuditoriumLayout = LAYOUT_BUILDERS[kind](`${v.slug}-screen-${ai + 1}`);
        layout.name = kind === 'luxe' ? `Screen ${ai + 1} · Luxe` : kind === 'premiere' ? `Screen ${ai + 1} · Premiere` : `Screen ${ai + 1}`;
        const issues = validateLayout(layout);
        if (issues.length) throw new Error(`Invalid layout ${layout.id}: ${issues[0].message}`);
        const aud = await prisma.auditorium.create({ data: { tenantId: tenant.id, venueId: venue.id, name: layout.name, screenNumber: ai + 1 } });
        const lv = await prisma.auditoriumLayoutVersion.create({
          data: { auditoriumId: aud.id, version: 1, status: 'PUBLISHED', geometry: layout as unknown as Prisma.InputJsonValue, seatCount: layout.seats.length, publishedAt: now },
        });

        for (let d = 0; d < DAYS; d++) {
          const date = zonedDate(new Date(now.getTime() + d * 86400_000), venue.timeZone);
          for (const [si, time] of SHOW_TIMES.entries()) {
            const startsAt = zonedToUtc(date, time, venue.timeZone);
            if (startsAt <= now) continue;
            const film = showing[(vi * 5 + ai * 3 + si + d) % showing.length];
            const fx = FILMS.find((x) => x.slug === film.slug)!;
            const isBigScreen = kind === 'curved';
            let formats = film.formats.find((f) => (isBigScreen ? f.includes('IMAX') || f.includes('Dolby Atmos') : f.length === 1 && f[0] === '2D')) ?? ['2D'];
            if (kind === 'luxe' || kind === 'premiere') formats = ['2D'];
            const attributes = formats.filter((f) => ['Audio Described', 'Subtitled', 'Relaxed'].includes(f));
            formats = formats.filter((f) => !attributes.includes(f));
            const screening = await prisma.screening.create({
              data: {
                tenantId: tenant.id, venueId: venue.id, auditoriumId: aud.id, layoutVersionId: lv.id, filmId: film.id,
                startsAt, endsAt: new Date(startsAt.getTime() + (fx.runtimeMinutes + 20) * 60000), formats, attributes,
              },
            });
            // Simulate box office sales from other channels and a few maintenance blocks.
            const demand = 0.08 + random() * 0.4 * (si >= 2 ? 1.4 : 0.7);
            await prisma.screeningSeat.createMany({
              data: layout.seats.map((s) => {
                const r = random();
                const state = r < 0.01 ? 'BLOCKED' : r < demand ? 'SOLD' : 'AVAILABLE';
                return { screeningId: screening.id, seatId: s.id, state };
              }),
            });
            screeningCount++;
          }
        }
      }
    }
    // A couple of preview screenings for coming-soon films at the first venue.
    console.log(`  ${films.length} films, ${t.venues.length} venues, ${screeningCount} screenings (${upcoming.length} coming soon)`);

    const release = await config.publish(tenant, null, { note: 'Initial seed' });
    const snapshot = await config.current(tenant.id);
    const dir = join(__dirname, '../../shared/fixtures/tenant-config');
    if (process.env.WRITE_FIXTURES !== 'false') mkdirSync(dir, { recursive: true });
    // Refresh the committed fallback configs only when asked (ids are random per seed).
    if (process.env.WRITE_FIXTURES !== 'false') {
      const json = JSON.stringify({ ...snapshot, publishedAt: '2026-01-01T00:00:00.000Z' }, null, 2) + '\n';
      writeFileSync(join(dir, `${t.slug}.json`), json);
      writeFileSync(join(__dirname, `../../ios/Packages/CinemaKit/Sources/CinemaCore/PreviewData/tenant-config-${t.slug}.json`), json);
    }
    console.log(`  Published config v${release.version}`);
  }

  console.log(`\nMenu specials: ${await ensureFixtureMenuSpecials(prisma, { seeding: true })} added`);
  console.log(`\nProduct images: ${await ensureFixtureProductImages(prisma)} demo products given artwork`);
  console.log(`Cinema photos: ${await ensureFixtureVenueImages(prisma)} demo cinemas given a photo`);
  console.log(`Offer banners: ${await ensureFixturePromotionImages(prisma)} demo offers given a photo`);
  console.log(`Pulse: ${await ensureDemoHistory(prisma)} demo show outcomes (labelled demo)`);
  console.log(`Pulse: ${await ensureDemoInterest(prisma, DEMO_TENANTS, SLOT_BASE)} demo films given audience interest (labelled demo)`);
  console.log(`Pulse: ${await ensureDemoConversation(prisma, DEMO_TENANTS)} demo films given social conversation (labelled demo)`);
  console.log('\nDev logins (admin portal):');
  console.log('  platform@cinema.example / platform-dev-password');
  for (const t of TENANTS) console.log(`  admin@${t.slug}.example / operator-dev-password`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

// Keep PrismaClient import referenced for tooling that inspects seed files.
export type _Seed = PrismaClient;
