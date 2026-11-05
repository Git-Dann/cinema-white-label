import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Clock } from '../src/common/clock';
import { api, createApp } from './harness';

describe('tenant configuration publishing (integration)', () => {
  let app: INestApplication;
  let token: string;
  let editorToken: string;
  const A = '/v1/admin/t/kestrel';

  beforeAll(async () => {
    app = await createApp();
    const login = (email: string, password: string) => request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email, password }).expect(200);
    token = (await login('admin@kestrel.example', 'operator-dev-password')).body.token;
    editorToken = (await login('editor@kestrel.example', 'editor-dev-password')).body.token;
  });
  afterAll(async () => app.close());

  it('rejects bad credentials and cross-tenant admin access', async () => {
    await request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email: 'admin@kestrel.example', password: 'nope' }).expect(401);
    await api(app, token).get('/v1/admin/t/northlight/settings').expect(403);
  });

  it('previews without saving and reports contrast failures', async () => {
    const r = await api(app, token).post(`${A}/preview`, { draft: { themeId: 'light' }, palette: { name: 'Pale', accent: { light: '#FFF59D', dark: '#FFF59D' }, secondary: { light: '#FFFDE7', dark: '#FFFDE7' } } }, null).expect(200);
    expect(r.body.report.ok).toBe(false);
    expect(r.body.report.issues.some((i: any) => i.kind === 'contrast')).toBe(true);
  });

  it('refuses to approve an inaccessible palette', async () => {
    const p = (await api(app, token).post(`${A}/palettes`, { name: 'Too pale', accent: { light: '#FFF59D', dark: '#FFF59D' }, secondary: { light: '#FFFDE7', dark: '#FFFDE7' } }, null).expect(201)).body;
    const r = await api(app, token).post(`${A}/palettes/${p.id}/approve`, {}, null);
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('publish_blocked');
  });

  it('blocks publishing with an unapproved palette', async () => {
    const p = (await api(app, token).post(`${A}/palettes`, { name: 'Unreviewed', accent: { light: '#1D4ED8', dark: '#60A5FA' }, secondary: { light: '#6D28D9', dark: '#A78BFA' } }, null).expect(201)).body;
    await api(app, token).put(`${A}/settings`, { paletteId: p.id }).expect(200);
    const r = await api(app, token).post(`${A}/releases`, { note: 'should fail' }, null);
    expect(r.status).toBe(422);
    await api(app, token).post(`${A}/palettes/${p.id}/approve`, {}, null).expect(200);
  });

  it('publishes a new version the app can fetch, and only operator admins may publish', async () => {
    const before = (await api(app).get('/v1/t/kestrel/config').expect(200)).body;
    await api(app, editorToken).put(`${A}/settings`, { themeId: 'premium', wordmark: 'Kestrel' }).expect(200);
    await api(app, editorToken).post(`${A}/releases`, { note: 'editor try' }, null).expect(403);
    const rel = (await api(app, token).post(`${A}/releases`, { note: 'Premium look' }, null).expect(201)).body;
    expect(rel.version).toBe(before.version + 1);
    const after = (await api(app).get('/v1/t/kestrel/config').expect(200)).body;
    expect(after.version).toBe(rel.version);
    expect(after.theme.themeId).toBe('premium');
    expect(after.theme.dark.actionPrimary).toBe('#60A5FA');
  });

  it('rolls back by publishing the old snapshot as a new version', async () => {
    const current = (await api(app).get('/v1/t/kestrel/config')).body;
    const r = (await api(app, token).post(`${A}/releases/1/rollback`, {}, null).expect(201)).body;
    expect(r.version).toBe(current.version + 1);
    const live = (await api(app).get('/v1/t/kestrel/config')).body;
    expect(live.version).toBe(r.version);
    expect(live.theme.themeId).toBe('classic');
    const audit = (await api(app, token).get(`${A}/audit`).expect(200)).body;
    expect(audit.some((e: any) => e.action === 'release.rollback')).toBe(true);
  });

  it('activates scheduled releases when they fall due', async () => {
    await api(app, token).put(`${A}/settings`, { themeId: 'highContrast' }).expect(200);
    const at = new Date(Date.now() + 3600_000).toISOString();
    const rel = (await api(app, token).post(`${A}/releases`, { note: 'Later', scheduledFor: at }, null).expect(201)).body;
    expect(rel.status).toBe('SCHEDULED');
    expect((await api(app).get('/v1/t/kestrel/config')).body.theme.themeId).toBe('classic');
    app.get(Clock).advance(3601_000);
    const live = (await api(app).get('/v1/t/kestrel/config')).body;
    expect(live.version).toBe(rel.version);
    expect(live.theme.themeId).toBe('highContrast');
    app.get(Clock).reset();
  });

  it('cancels a waiting scheduled release when a newer one is published immediately', async () => {
    const at = new Date(Date.now() + 7200_000).toISOString();
    const scheduled = (await api(app, token).post(`${A}/releases`, { note: 'Christmas', scheduledFor: at }, null).expect(201)).body;
    const now = (await api(app, token).post(`${A}/releases`, { note: 'Hotfix' }, null).expect(201)).body;
    const list = (await api(app, token).get(`${A}/releases`).expect(200)).body as any[];
    expect(list.find((r) => r.version === scheduled.version).status).toBe('CANCELLED');
    expect(list.find((r) => r.version === now.version).status).toBe('PUBLISHED');
    const bad = await api(app, token).post(`${A}/releases/${scheduled.version}/rollback`, {}, null);
    expect(bad.status).toBe(422);
  });
});
