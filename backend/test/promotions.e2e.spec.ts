import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { api, createApp, T } from './harness';
import { PrismaService } from '../src/common/prisma.service';

describe('promotions (integration)', () => {
  let app: INestApplication;
  let admin: string;
  let editor: string;
  const A = '/v1/admin/t/northlight/promotions';

  beforeAll(async () => {
    app = await createApp();
    const login = (email: string, password: string) => request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email, password }).expect(200);
    admin = (await login('admin@northlight.example', 'operator-dev-password')).body.token;
    editor = (await login('editor@northlight.example', 'editor-dev-password')).body.token;
  });
  afterAll(async () => app.close());
  const prisma = () => app.get(PrismaService);

  it('serves the seeded promotions with typed actions', async () => {
    const list = (await api(app).get(`${T}/promotions`).expect(200)).body;
    expect(list.map((p: any) => p.action.kind)).toEqual(['voucher', 'film']);
    expect(list[0]).toMatchObject({ title: 'New here? 10% off', ctaLabel: 'Show code', action: { kind: 'voucher', code: 'WELCOME10' } });
    expect(list[1].action.filmId).toBeTruthy();
  });

  it('hides a voucher promotion while the voucher cannot be redeemed', async () => {
    const tenant = await prisma().tenant.findUniqueOrThrow({ where: { slug: 'northlight' } });
    await prisma().voucher.update({ where: { tenantId_code: { tenantId: tenant.id, code: 'WELCOME10' } }, data: { active: false } });
    try {
      const list = (await api(app).get(`${T}/promotions`).expect(200)).body;
      expect(list.some((p: any) => p.action.kind === 'voucher')).toBe(false);
      // The admin list still shows it, flagged as not showing.
      const rows = (await api(app, admin).get(A).expect(200)).body;
      expect(rows.find((r: any) => r.voucherCode === 'WELCOME10').showing).toBe(false);
    } finally {
      await prisma().voucher.update({ where: { tenantId_code: { tenantId: tenant.id, code: 'WELCOME10' } }, data: { active: true } });
    }
  });

  it('validates actions, links and dates', async () => {
    const bad = (body: object) => api(app, admin).post(A, { title: 'T', body: 'B', ctaLabel: 'Go', ...body }, null);
    expect((await bad({ action: 'link', linkUrl: 'http://example.com' })).status).toBe(422);
    expect((await bad({ action: 'film' })).status).toBe(422);
    expect((await bad({ action: 'voucher', voucherCode: 'NOPE' })).status).toBe(422);
    expect((await bad({ action: 'none', validFrom: '2026-12-02T00:00:00Z', validTo: '2026-12-01T00:00:00Z' })).status).toBe(422);
    expect((await bad({ action: 'link', linkUrl: 'https://northlight.example/members', ctaLabel: '' })).status).toBe(422);
  });

  it('respects cinema scope and start dates, and editors can manage promotions', async () => {
    const leeds = (await api(app).get(`${T}/venues/leeds-riverside`).expect(200)).body;
    const local = (await api(app, editor).post(A, {
      title: 'Leeds quiz night', body: 'Film quiz in the bar, Thursdays.', ctaLabel: 'Details', action: 'link', linkUrl: 'https://northlight.example/leeds/quiz', venueId: leeds.id,
    }).expect(201)).body;
    const future = (await api(app, editor).post(A, {
      title: 'Coming in spring', body: 'Not yet.', action: 'none', validFrom: new Date(Date.now() + 86_400_000).toISOString(),
    }).expect(201)).body;

    const everywhere = (await api(app).get(`${T}/promotions`)).body.map((p: any) => p.id);
    const atLeeds = (await api(app).get(`${T}/promotions?venueId=${leeds.id}`)).body;
    expect(everywhere).not.toContain(local.id);
    expect(atLeeds.find((p: any) => p.id === local.id)).toMatchObject({ action: { kind: 'link', url: 'https://northlight.example/leeds/quiz' } });
    expect([...everywhere, ...atLeeds.map((p: any) => p.id)]).not.toContain(future.id);

    // Switching action clears the old target; a promotion without an action has no button.
    const updated = (await api(app, editor).put(`${A}/${local.id}`, { action: 'none' }).expect(200)).body;
    expect(updated.linkUrl).toBeNull();
    const shown = (await api(app).get(`${T}/promotions?venueId=${leeds.id}`)).body.find((p: any) => p.id === local.id);
    expect(shown).toMatchObject({ ctaLabel: null, action: { kind: 'none' } });

    await api(app, editor).del(`${A}/${local.id}`).expect(204);
    await api(app, admin).del(`${A}/${future.id}`).expect(204);
    await api(app, admin).del(`${A}/${future.id}`).expect(404);
  });

  it('keeps promotions tenant-scoped', async () => {
    const kestrel = (await api(app).get('/v1/t/kestrel/promotions').expect(200)).body;
    const northlight = (await api(app).get(`${T}/promotions`).expect(200)).body;
    expect(kestrel.map((p: any) => p.id)).not.toEqual(expect.arrayContaining(northlight.map((p: any) => p.id)));
    const id = northlight[0].id;
    const login = await request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email: 'admin@kestrel.example', password: 'operator-dev-password' }).expect(200);
    await api(app, login.body.token).put(`/v1/admin/t/kestrel/promotions/${id}`, { title: 'Hijack' }).expect(404);
  });
});
