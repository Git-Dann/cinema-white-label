// Runs during a Vercel build when RUN_DB_DEPLOY=true: applies migrations, then
// seeds demo data only if the database is empty (never wipes an existing one).
const { execSync } = require('child_process');

if (process.env.RUN_DB_DEPLOY !== 'true') {
  console.log('deploy-db: RUN_DB_DEPLOY is not true; skipping migrations and seed.');
  process.exit(0);
}
if (!process.env.DATABASE_URL) {
  console.error('deploy-db: DATABASE_URL is not set. Add it in Vercel > Settings > Environment Variables.');
  process.exit(1);
}

const run = (cmd, env = {}) => execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });

run('npx prisma migrate deploy');

(async () => {
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  const tenants = await prisma.tenant.count();
  await prisma.$disconnect();
  if (tenants > 0) {
    console.log(`deploy-db: ${tenants} operators already exist; not seeding.`);
    return;
  }
  console.log('deploy-db: empty database; seeding demo data.');
  run('pnpm db:seed', { WRITE_FIXTURES: 'false' });
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
