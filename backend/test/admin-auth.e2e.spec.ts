import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createApp } from './harness';

const exp = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { iat: number; exp: number };

describe('admin sign-in: remember me (integration)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => app.close());
  const login = (body: object) => request(app.getHttpServer()).post('/v1/admin/auth/login').send(body);

  it('a normal sign-in lasts 8 hours', async () => {
    const r = (await login({ email: 'admin@northlight.example', password: 'operator-dev-password' }).expect(200)).body;
    const c = exp(r.token);
    expect(c.exp - c.iat).toBe(8 * 3600);
    expect(r.expiresIn).toBe(8 * 3600);
  });

  it('remember me lasts 30 days', async () => {
    const r = (await login({ email: 'admin@northlight.example', password: 'operator-dev-password', remember: true }).expect(200)).body;
    const c = exp(r.token);
    expect(c.exp - c.iat).toBe(30 * 24 * 3600);
    expect(r.expiresIn).toBe(30 * 24 * 3600);
  });

  it('remember me does not get past a wrong password', async () => {
    await login({ email: 'admin@northlight.example', password: 'nope', remember: true }).expect(401);
  });

  it('rejects a remember flag that is not a boolean', async () => {
    const r = await login({ email: 'admin@northlight.example', password: 'operator-dev-password', remember: 'yes' });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.status).toBeLessThan(500);
  });
});
