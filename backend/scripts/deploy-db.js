// Runs during a Vercel build: applies migrations, then seeds demo data only if the database is
// empty (never wipes an existing one).
//
// - Production builds only, unless RUN_DB_DEPLOY_PREVIEW=true. Preview deployments share the
//   production database (docs/hosting.md), so an unmerged branch must not migrate it.
// - Migrations use DIRECT_URL when it is set (Supabase's session pooler or direct connection), so the
//   app's DATABASE_URL can be the transaction pooler that serverless functions need. Without
//   DIRECT_URL they use DATABASE_URL, as before.
// - A full connection pool (Supabase EMAXCONNSESSION, Postgres "too many clients") is retried a few
//   times with a short wait, since concurrent builds and functions can hold every slot for a moment.
const { execSync } = require('child_process');

/** Why this build should or should not touch the database. */
function decide(env) {
  if (env.RUN_DB_DEPLOY !== 'true') return { run: false, reason: 'RUN_DB_DEPLOY is not true' };
  const target = env.VERCEL_ENV;
  if (target && target !== 'production' && env.RUN_DB_DEPLOY_PREVIEW !== 'true') {
    return { run: false, reason: `this is a ${target} build (set RUN_DB_DEPLOY_PREVIEW=true to migrate from previews)` };
  }
  if (!env.DATABASE_URL) return { run: false, error: 'DATABASE_URL is not set. Add it in Vercel > Settings > Environment Variables.' };
  return { run: true };
}

/** The connection string migrations use: DIRECT_URL when set, else DATABASE_URL. */
function migrationUrl(env) {
  return env.DIRECT_URL || env.DATABASE_URL;
}

/** True for errors that mean "every connection slot is taken right now", which a retry can outlast. */
function isPoolFull(error) {
  const text = `${error && error.message}\n${error && error.stdout}\n${error && error.stderr}`;
  return /EMAXCONNSESSION|max clients reached|too many clients|remaining connection slots are reserved/i.test(text);
}

function withRetries(fn, { attempts = 4, waitMs = 5000, sleep = (ms) => execSync(`sleep ${ms / 1000}`) } = {}) {
  for (let i = 1; ; i++) {
    try {
      return fn();
    } catch (e) {
      if (i >= attempts || !isPoolFull(e)) throw e;
      console.warn(`deploy-db: the database pool is full (attempt ${i} of ${attempts}); retrying in ${(waitMs * i) / 1000}s.`);
      sleep(waitMs * i);
    }
  }
}

function main(env = process.env) {
  const d = decide(env);
  if (d.error) {
    console.error(`deploy-db: ${d.error}`);
    process.exit(1);
  }
  if (!d.run) {
    console.log(`deploy-db: ${d.reason}; skipping migrations and seed.`);
    return;
  }

  // the command's output is captured so a full pool can be recognised, then printed
  const run = (cmd, extra = {}) => {
    const out = execSync(cmd, { encoding: 'utf8', stdio: 'pipe', env: { ...env, ...extra } });
    if (out) process.stdout.write(out);
  };
  const migrateEnv = { DATABASE_URL: migrationUrl(env) };
  if (env.DIRECT_URL) console.log('deploy-db: migrating through DIRECT_URL.');
  withRetries(() => run('npx prisma migrate deploy', migrateEnv));

  (async () => {
    const { PrismaClient } = require('@prisma/client');
    const prisma = new PrismaClient({ datasources: { db: { url: migrationUrl(env) } } });
    const tenants = await prisma.tenant.count();
    if (tenants > 0) {
      console.log(`deploy-db: ${tenants} operators already exist; not seeding.`);
      // Demo products from before menu artwork existed get it now; products with an image are never touched.
      // Specials, bundles and film tie-ins arrived later; operators without any featured products get the demo ones once.
      const { ensureFixtureMenuSpecials } = require('../dist/fixtures/menu-specials');
      console.log(`deploy-db: added ${await ensureFixtureMenuSpecials(prisma)} demo specials.`);
      // Keep a week of screenings programmed, so the demo never runs out of showtimes.
      const { ensureScreeningHorizon } = require('../dist/catalogue/schedule');
      for (const t of await prisma.tenant.findMany({ select: { id: true, slug: true } })) {
        const r = await ensureScreeningHorizon(prisma, t.id, new Date());
        console.log(`deploy-db: ${t.slug}: ${r.created} screenings added, ${r.reassigned} moved to showing films.`);
      }
      const { ensureFixtureProductImages } = require('../dist/fixtures/product-images');
      console.log(`deploy-db: gave ${await ensureFixtureProductImages(prisma)} demo products their artwork.`);
      const { ensureFixtureVenueImages } = require('../dist/fixtures/venue-images');
      console.log(`deploy-db: gave ${await ensureFixtureVenueImages(prisma)} demo cinemas their photo.`);
      const { ensureFixturePromotionImages } = require('../dist/fixtures/promotion-images');
      console.log(`deploy-db: gave ${await ensureFixturePromotionImages(prisma)} demo offers a banner photo.`);
      await prisma.$disconnect();
      return;
    }
    await prisma.$disconnect();
    console.log('deploy-db: empty database; seeding demo data.');
    withRetries(() => run('pnpm db:seed', { ...migrateEnv, WRITE_FIXTURES: 'false' }));
  })().catch((e) => {
    console.error(e.stderr || e);
    process.exit(1);
  });
}

if (require.main === module) {
  try {
    main();
  } catch (e) {
    if (e.stdout) process.stdout.write(String(e.stdout));
    if (e.stderr) process.stderr.write(String(e.stderr));
    console.error(`deploy-db: ${e.message}`);
    process.exit(1);
  }
}

module.exports = { decide, migrationUrl, isPoolFull, withRetries };
