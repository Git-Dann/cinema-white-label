import { createHash, createHmac, randomBytes } from 'crypto';
import { isIP } from 'net';

/** A new partner key: "sf_live_" and 32 random characters. Only its hash is stored. */
export function newApiKey() {
  const key = `sf_live_${randomBytes(24).toString('base64url')}`;
  return { key, prefix: key.slice(0, 12), hash: hashKey(key) };
}

/** Keys are long and random, so a plain SHA-256 is enough to store them safely. */
export function hashKey(key: string) {
  return createHash('sha256').update(key).digest('hex');
}

export function newWebhookSecret() {
  return `whsec_${randomBytes(24).toString('base64url')}`;
}

/**
 * Signature header sent with every webhook: "t=<unix seconds>,v1=<hex HMAC-SHA256 of
 * `${t}.${body}` with the webhook secret>". Receivers recompute it and reject old timestamps.
 */
export function signPayload(secret: string, body: string, at: Date) {
  const t = Math.floor(at.getTime() / 1000);
  const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
  return `t=${t},v1=${v1}`;
}

/**
 * Webhook URLs must be public HTTPS. Plain HTTP, localhost and private network
 * addresses are refused so a webhook can't be pointed at internal systems.
 * Tests may allow local addresses with WEBHOOK_ALLOW_LOCAL=1.
 */
export function webhookUrlProblem(raw: string, env = process.env): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return 'Enter a full URL, starting https://';
  }
  const local = env.WEBHOOK_ALLOW_LOCAL === '1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return 'Webhook URLs must use https://';
  if (u.username || u.password) return 'Leave usernames and passwords out of the URL';
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (local) return null;
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return 'Use a public address, not a local one';
  if (isIP(host) && privateAddress(host)) return 'Use a public address, not a private network one';
  return null;
}

function privateAddress(ip: string) {
  if (ip.includes(':')) return ip === '::1' || /^f[cd]/.test(ip) || ip.startsWith('fe80') || ip === '::';
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}
