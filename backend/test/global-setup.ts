import { execSync } from 'child_process';
import { join } from 'path';

/**
 * Integration tests run against a dedicated database (cinema_test by default)
 * that is migrated and re-seeded once per run. Never point this at a shared database.
 */
export default async function globalSetup() {
  const root = join(__dirname, '..');
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://cinema:cinema@localhost:5432/cinema_test';
  if (!/_test(\?|$)/.test(url)) throw new Error(`Refusing to reset a non-test database: ${url}`);
  process.env.DATABASE_URL = url;
  process.env.AUTH_SECRET = 'test-secret';
  const env = { ...process.env, DATABASE_URL: url, AUTH_SECRET: 'test-secret', WRITE_FIXTURES: 'false' };
  // Non-destructive: applies pending migrations only. The seed then replaces fixture data.
  execSync('npx prisma migrate deploy', { cwd: root, env, stdio: 'pipe' });
  execSync('npx ts-node --transpile-only prisma/seed.ts', { cwd: root, env, stdio: 'pipe' });
}
