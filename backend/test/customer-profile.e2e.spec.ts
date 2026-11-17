import { INestApplication } from '@nestjs/common';
import { PrismaService } from '../src/common/prisma.service';
import { api, createApp, guest } from './harness';

describe('customer profile (integration)', () => {
  let app: INestApplication;
  let token: string;
  const P = '/v1/t/northlight/me/profile';
  const details = { givenName: ' Dan ', familyName: 'Lindsay', email: 'Dan@Example.com', phone: '07700 900123', marketingOptIn: false };

  beforeAll(async () => {
    app = await createApp();
    token = await guest(app, 'northlight');
  });
  afterAll(async () => app.close());

  it('starts empty and needs a session', async () => {
    await api(app).get(P).expect(401);
    expect((await api(app, token).get(P).expect(200)).body).toEqual({ givenName: null, familyName: null, email: null, phone: null, marketingOptIn: false, updatedAt: null });
  });

  it('saves tidied details and keeps the display name in step', async () => {
    const r = await api(app, token).put(P, details).expect(200);
    expect(r.body).toMatchObject({ givenName: 'Dan', familyName: 'Lindsay', email: 'dan@example.com', phone: '07700 900123', marketingOptIn: false });
    expect(r.body.updatedAt).toEqual(expect.any(String));
    const c = await app.get(PrismaService).customer.findFirstOrThrow({ where: { email: 'dan@example.com' } });
    expect(c.displayName).toBe('Dan Lindsay');
    expect(c.marketingConsentAt).toBeNull();
  });

  it('records when marketing consent was given, and needs an email for it', async () => {
    await api(app, token).put(P, { ...details, email: '', marketingOptIn: true }).expect(422);
    await api(app, token).put(P, { ...details, marketingOptIn: true }).expect(200);
    const c = await app.get(PrismaService).customer.findFirstOrThrow({ where: { email: 'dan@example.com' } });
    expect(c.marketingConsentAt).toBeInstanceOf(Date);
  });

  it('rejects bad input and fields that are not the customer\'s to set', async () => {
    await api(app, token).put(P, { ...details, email: 'dan@' }).expect(422);
    await api(app, token).put(P, { ...details, tenantId: 'someone-else' }).expect(422);
  });

  it('keeps each operator\'s copy separate', async () => {
    await api(app, token).get('/v1/t/kestrel/me/profile').expect((r) => expect([401, 403]).toContain(r.status));
    const other = await guest(app, 'kestrel');
    expect((await api(app, other).get('/v1/t/kestrel/me/profile').expect(200)).body.email).toBeNull();
  });

  it('removes everything on request', async () => {
    const r = await api(app, token).del(P).expect(200);
    expect(r.body).toMatchObject({ givenName: null, familyName: null, email: null, phone: null, marketingOptIn: false });
  });
});
