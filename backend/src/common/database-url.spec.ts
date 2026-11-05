import { runtimeDatabaseUrl } from './database-url';

describe('runtimeDatabaseUrl', () => {
  const session = 'postgresql://postgres.abc:p%40ss@aws-1-eu-west-2.pooler.supabase.com:5432/postgres';

  it('leaves the URL alone outside serverless hosting', () => {
    expect(runtimeDatabaseUrl(session, false)).toBe(session);
  });

  it('moves a Supabase session-pooler URL to the transaction pooler with one connection', () => {
    const u = new URL(runtimeDatabaseUrl(session, true)!);
    expect(u.port).toBe('6543');
    expect(u.searchParams.get('pgbouncer')).toBe('true');
    expect(u.searchParams.get('connection_limit')).toBe('1');
    expect(u.username).toBe('postgres.abc');
    expect(decodeURIComponent(u.password)).toBe('p@ss');
  });

  it('caps other hosts at one connection without changing the port', () => {
    const u = new URL(runtimeDatabaseUrl('postgresql://u:p@db.example.com:5432/app', true)!);
    expect(u.port).toBe('5432');
    expect(u.searchParams.has('pgbouncer')).toBe(false);
    expect(u.searchParams.get('connection_limit')).toBe('1');
  });

  it('keeps an explicit connection limit', () => {
    const u = new URL(runtimeDatabaseUrl('postgresql://u:p@db.example.com/app?connection_limit=3', true)!);
    expect(u.searchParams.get('connection_limit')).toBe('3');
  });
});
