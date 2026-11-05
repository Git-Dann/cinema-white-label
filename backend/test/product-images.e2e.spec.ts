import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import sharp from 'sharp';
import { api, createApp, T } from './harness';
import { PrismaService } from '../src/common/prisma.service';

describe('food and drink images (integration)', () => {
  let app: INestApplication;
  let admin: string;
  const A = '/v1/admin/t/northlight';
  const prisma = () => app.get(PrismaService);

  const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#C8372D' } }).png().toBuffer();

  beforeAll(async () => {
    app = await createApp();
    admin = (await request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email: 'admin@northlight.example', password: 'operator-dev-password' }).expect(200)).body.token;
  });
  afterAll(async () => app.close());

  it('gives seeded products their generated artwork, served to the app and the portal', async () => {
    const venues = (await api(app).get(`${T}/venues`).expect(200)).body;
    const leeds = venues.find((v: any) => v.features.concessions);
    const menu = (await api(app).get(`${T}/venues/${leeds.id}/concessions`).expect(200)).body;
    const popcorn = menu.categories.flatMap((c: any) => c.items).find((p: any) => p.sku === 'POP-SWEET');
    expect(popcorn.image).toMatchObject({ width: 1200, height: 900 });
    await api(app).get(popcorn.image.url.replace(/^.*(\/v1\/media\/)/, '$1') + '&w=342').expect(200).expect('Content-Type', 'image/jpeg');

    const portal = (await api(app, admin).get(`${A}/concessions`).expect(200)).body;
    expect(portal.every((p: any) => p.image)).toBe(true);
  });

  it('stores uploads in the database, shrinks big ones, and lets a product use them', async () => {
    const big = await png(3000, 2250);
    const up = (await api(app, admin).post(`${A}/media`, { kind: 'PRODUCT', dataBase64: big.toString('base64') }).expect(201)).body;
    expect(up).toMatchObject({ width: 2000, height: 1500 });

    const asset = await prisma().mediaAsset.findUniqueOrThrow({ where: { id: up.id } });
    expect(asset.kind).toBe('PRODUCT');
    const blob = await prisma().mediaBlob.findUnique({ where: { storageKey: asset.storageKey } });
    expect(blob?.data.length).toBeGreaterThan(0);

    const product = (await api(app, admin).get(`${A}/concessions`).expect(200)).body.find((p: any) => p.sku === 'WATER');
    const updated = (await api(app, admin).put(`${A}/concessions/${product.id}`, { imageAssetId: up.id }).expect(200)).body;
    expect(updated.image.id).toBe(up.id);
    await api(app).get(`/v1/media/${up.id}?w=500`).expect(200);

    // Editing something else keeps the image; null removes it.
    expect((await api(app, admin).put(`${A}/concessions/${product.id}`, { priceMinor: 310 }).expect(200)).body.image.id).toBe(up.id);
    expect((await api(app, admin).put(`${A}/concessions/${product.id}`, { imageAssetId: null }).expect(200)).body.image).toBeNull();
  });

  it('refuses images that are not food and drink images, or belong to another operator', async () => {
    const product = (await api(app, admin).get(`${A}/concessions`).expect(200)).body[0];
    const poster = (await api(app, admin).post(`${A}/media`, { kind: 'POSTER', dataBase64: (await png(400, 600)).toString('base64') }).expect(201)).body;
    await api(app, admin).put(`${A}/concessions/${product.id}`, { imageAssetId: poster.id }).expect(422);

    const kestrel = await prisma().tenant.findUniqueOrThrow({ where: { slug: 'kestrel' } });
    const theirs = await prisma().mediaAsset.findFirstOrThrow({ where: { tenantId: kestrel.id, kind: 'PRODUCT' } });
    await api(app, admin).put(`${A}/concessions/${product.id}`, { imageAssetId: theirs.id }).expect(422);
  });
});
