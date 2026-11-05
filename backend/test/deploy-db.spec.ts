// scripts/deploy-db.js decides at build time whether to touch the database. Preview deployments share
// the production database, so they must not migrate it unless asked to.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { decide, migrationUrl, isPoolFull, withRetries } = require('../scripts/deploy-db.js');

const DB = 'postgresql://u:p@pooler.example:6543/postgres';
const DIRECT = 'postgresql://u:p@pooler.example:5432/postgres';

describe('deploy-db', () => {
  describe('decide', () => {
    it('skips when RUN_DB_DEPLOY is not true', () => {
      expect(decide({ DATABASE_URL: DB, VERCEL_ENV: 'production' })).toMatchObject({ run: false });
    });

    it('migrates a production build', () => {
      expect(decide({ RUN_DB_DEPLOY: 'true', DATABASE_URL: DB, VERCEL_ENV: 'production' })).toEqual({ run: true });
    });

    it('skips a preview build, which shares the production database', () => {
      const d = decide({ RUN_DB_DEPLOY: 'true', DATABASE_URL: DB, VERCEL_ENV: 'preview' });
      expect(d.run).toBe(false);
      expect(d.reason).toMatch(/preview/);
    });

    it('migrates a preview build only when RUN_DB_DEPLOY_PREVIEW is true', () => {
      expect(decide({ RUN_DB_DEPLOY: 'true', RUN_DB_DEPLOY_PREVIEW: 'true', DATABASE_URL: DB, VERCEL_ENV: 'preview' })).toEqual({ run: true });
    });

    it('migrates outside Vercel (no VERCEL_ENV), as before', () => {
      expect(decide({ RUN_DB_DEPLOY: 'true', DATABASE_URL: DB })).toEqual({ run: true });
    });

    it('fails when DATABASE_URL is missing', () => {
      expect(decide({ RUN_DB_DEPLOY: 'true', VERCEL_ENV: 'production' }).error).toMatch(/DATABASE_URL/);
    });
  });

  describe('migrationUrl', () => {
    it('uses DIRECT_URL when it is set', () => {
      expect(migrationUrl({ DATABASE_URL: DB, DIRECT_URL: DIRECT })).toBe(DIRECT);
    });

    it('falls back to DATABASE_URL', () => {
      expect(migrationUrl({ DATABASE_URL: DB })).toBe(DB);
    });
  });

  describe('isPoolFull', () => {
    it('recognises a full Supabase session pool', () => {
      const e = Object.assign(new Error('Command failed: npx prisma migrate deploy'), {
        stderr: 'Error: Schema engine error:\nFATAL: (EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15',
      });
      expect(isPoolFull(e)).toBe(true);
    });

    it('recognises Postgres running out of connections', () => {
      expect(isPoolFull(new Error('FATAL: sorry, too many clients already'))).toBe(true);
    });

    it('does not retry other failures, such as a broken migration', () => {
      expect(isPoolFull(new Error('P3009: migrate found failed migrations in the target database'))).toBe(false);
    });
  });

  describe('withRetries', () => {
    const full = () => Object.assign(new Error('failed'), { stderr: 'FATAL: (EMAXCONNSESSION) max clients reached' });

    it('retries a full pool and succeeds', () => {
      let calls = 0;
      const waits: number[] = [];
      const result = withRetries(() => { calls += 1; if (calls < 3) throw full(); return 'ok'; }, { attempts: 4, waitMs: 10, sleep: (ms: number) => waits.push(ms) });
      expect(result).toBe('ok');
      expect(calls).toBe(3);
      expect(waits).toEqual([10, 20]);
    });

    it('gives up after the last attempt', () => {
      let calls = 0;
      expect(() => withRetries(() => { calls += 1; throw full(); }, { attempts: 3, waitMs: 1, sleep: () => undefined })).toThrow('failed');
      expect(calls).toBe(3);
    });

    it('does not retry an unrelated error', () => {
      let calls = 0;
      expect(() => withRetries(() => { calls += 1; throw new Error('syntax error in migration'); }, { attempts: 4, waitMs: 1, sleep: () => undefined })).toThrow('syntax error');
      expect(calls).toBe(1);
    });
  });
});
