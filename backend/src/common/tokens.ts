import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

/**
 * Minimal HS256 JWT implementation (no dependency). Tokens are short-lived
 * bearer credentials; the iOS app stores them in the Keychain.
 */

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');

export interface CustomerClaims {
  typ: 'customer';
  sub: string;
  tid: string;
}
export interface AdminClaims {
  typ: 'admin';
  sub: string;
  role: string;
  tid: string | null;
}
export type Claims = (CustomerClaims | AdminClaims) & { iat: number; exp: number };

function secret(): string {
  const s = process.env.AUTH_SECRET;
  if (!s) throw new Error('AUTH_SECRET is not set');
  return s;
}

export function signToken(claims: CustomerClaims | AdminClaims, ttlSeconds: number): string {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...claims, iat: now, exp: now + ttlSeconds }));
  const sig = createHmac('sha256', secret()).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyToken(token: string): Claims | null {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const expected = createHmac('sha256', secret()).update(`${parts[0]}.${parts[1]}`).digest();
  const given = Buffer.from(parts[2], 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString()) as Claims;
    if (claims.exp < Math.floor(Date.now() / 1000)) return null;
    return claims;
  } catch {
    return null;
  }
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const hash = scryptSync(password, Buffer.from(saltHex, 'hex'), 32);
  return timingSafeEqual(hash, Buffer.from(hashHex, 'hex'));
}

/** Signs an admission payload so door scanners can verify it offline. */
export function signAdmission(payload: string): string {
  const sig = createHmac('sha256', secret()).update(`admission:${payload}`).digest('base64url').slice(0, 22);
  return `${payload}.${sig}`;
}
