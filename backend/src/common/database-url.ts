/**
 * Connection settings for serverless hosting.
 *
 * Every serverless instance holds its own Prisma pool, and a page that loads a
 * dozen images can start a dozen instances at once. Supabase's session pooler
 * (port 5432) allows only 15 clients, so that exhausts it and requests fail.
 * At runtime on a serverless host we therefore:
 *  - switch a Supabase session-pooler URL to its transaction pooler (port 6543,
 *    same credentials), which multiplexes many short-lived clients, and tell
 *    Prisma it is behind PgBouncer (no prepared statements);
 *  - cap each instance at one connection.
 * Migrations keep using DATABASE_URL unchanged, since they need session mode.
 */
export function runtimeDatabaseUrl(url: string | undefined, serverless: boolean): string | undefined {
  if (!url || !serverless) return url;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return url;
  }
  if (u.hostname.endsWith('.pooler.supabase.com') && (u.port === '5432' || u.port === '')) {
    u.port = '6543';
    u.searchParams.set('pgbouncer', 'true');
  }
  if (!u.searchParams.has('connection_limit')) u.searchParams.set('connection_limit', '1');
  return u.toString();
}
