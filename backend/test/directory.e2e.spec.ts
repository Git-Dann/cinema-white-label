import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DirectoryEntry } from '@cinema/contracts';
import { PrismaService } from '../src/common/prisma.service';
import { api, createApp } from './harness';

describe('shared Seatfold app: operator directory (integration)', () => {
  let app: INestApplication;
  let admin: string;
  let editor: string;
  const list = (q = '') => request(app.getHttpServer()).get(`/v1/directory${q}`).expect(200);

  beforeAll(async () => {
    app = await createApp();
    const login = (email: string, password: string) => request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email, password }).expect(200);
    admin = (await login('admin@kestrel.example', 'operator-dev-password')).body.token;
    editor = (await login('editor@kestrel.example', 'editor-dev-password')).body.token;
  });
  afterAll(async () => {
    await app.get(PrismaService).tenant.update({ where: { slug: 'kestrel' }, data: { listedInSeatfoldApp: true } });
    await app.close();
  });

  it('lists opted-in operators with their published brand and cinemas, without needing a tenant', async () => {
    const r = await list();
    expect(r.body.map((e: DirectoryEntry) => e.slug).sort()).toEqual(['kestrel', 'northlight']);
    for (const e of r.body) {
      expect(DirectoryEntry.parse(e)).toBeTruthy();
      expect(e.venues.length).toBeGreaterThan(0);
      expect(e.accent.light).toMatch(/^#/);
    }
  });

  it('puts the operator with the nearest cinema first when given a location', async () => {
    const r = await list();
    const all = r.body as DirectoryEntry[];
    // Stand next to one of Kestrel's cinemas: Kestrel comes first, at about 0 km.
    const k = await app.get(PrismaService).venue.findFirstOrThrow({ where: { tenant: { slug: 'kestrel' } } });
    const near = (await list(`?lat=${k.latitude}&lng=${k.longitude}`)).body as DirectoryEntry[];
    expect(near[0].slug).toBe('kestrel');
    expect(near[0].venues[0].distanceKm).toBe(0);
    expect(all.every((e) => e.venues.every((v) => v.distanceKm === null))).toBe(true);
  });

  it('searches by operator, cinema, town or postcode', async () => {
    const k = await app.get(PrismaService).venue.findFirstOrThrow({ where: { tenant: { slug: 'kestrel' } } });
    expect((await list('?q=kestrel')).body.map((e: DirectoryEntry) => e.slug)).toEqual(['kestrel']);
    expect((await list(`?q=${encodeURIComponent(k.city)}`)).body.map((e: DirectoryEntry) => e.slug)).toContain('kestrel');
    expect((await list(`?q=${encodeURIComponent(k.postcode.toLowerCase())}`)).body.map((e: DirectoryEntry) => e.slug)).toContain('kestrel');
    expect((await list('?q=nowhere-at-all')).body).toEqual([]);
  });

  it('lets an operator admin, and only an admin, leave or rejoin the app', async () => {
    const A = '/v1/admin/t/kestrel/seatfold-app';
    expect((await api(app, admin).get(A).expect(200)).body).toEqual({ listed: true });
    await api(app, editor).put(A, { listed: false }).expect(403);
    await api(app, admin).put(A, { listed: false }).expect(200);
    expect((await list()).body.map((e: DirectoryEntry) => e.slug)).toEqual(['northlight']);
    await api(app, admin).put(A, { listed: true }).expect(200);
    expect((await list()).body.map((e: DirectoryEntry) => e.slug).sort()).toEqual(['kestrel', 'northlight']);
    await api(app, admin).put('/v1/admin/t/northlight/seatfold-app', { listed: false }).expect(403);
  });
});
