import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { api, createApp, T } from './harness';
import { ensureFixturePromotionImages } from '../src/fixtures/promotion-images';

describe('offer banners (integration)', () => {
  let app: INestApplication;
  let admin: string;
  const A = '/v1/admin/t/northlight';
  const prisma = new PrismaClient();
  const PIXEL = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=';

  beforeAll(async () => {
    app = await createApp();
    admin = (await request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email: 'admin@northlight.example', password: 'operator-dev-password' }).expect(200)).body.token;
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('gives demo offers a photo once, and film offers the film backdrop', async () => {
    await ensureFixturePromotionImages(prisma as any, { addSnacks: false });
    expect(await ensureFixturePromotionImages(prisma as any, { addSnacks: false })).toBe(0);
    const live = (await request(app.getHttpServer()).get(`${T}/promotions`).expect(200)).body as any[];
    const welcome = live.find((p) => p.action.kind === 'voucher');
    expect(welcome.image).toMatchObject({ width: 1200, height: 900 });
    const film = live.find((p) => p.action.kind === 'film');
    expect(film.image).not.toBeNull(); // the film's backdrop
  });

  it('adds the demo snacks offer once, with a photo and no button', async () => {
    await ensureFixturePromotionImages(prisma as any);
    await ensureFixturePromotionImages(prisma as any);
    const live = (await request(app.getHttpServer()).get(`${T}/promotions`).expect(200)).body as any[];
    const snacks = live.filter((p) => p.title === 'Pre-order your snacks');
    expect(snacks).toHaveLength(1);
    expect(snacks[0].image).not.toBeNull();
    expect(snacks[0].ctaLabel).toBeNull();
  });

  it('only accepts a photo uploaded for an offer, and the admin list returns it', async () => {
    const created = (await api(app, admin).post(`${A}/promotions`, { title: 'Late shows', body: 'Every Friday after 9pm.', action: 'none' }).expect(201)).body;
    const product = (await api(app, admin).post(`${A}/media`, { kind: 'PRODUCT', dataBase64: PIXEL }).expect(201)).body;
    await api(app, admin).put(`${A}/promotions/${created.id}`, { imageAssetId: product.id }).expect(422);
    const banner = (await api(app, admin).post(`${A}/media`, { kind: 'BANNER', dataBase64: PIXEL }).expect(201)).body;
    await api(app, admin).put(`${A}/promotions/${created.id}`, { imageAssetId: banner.id }).expect(200);
    const rows = (await api(app, admin).get(`${A}/promotions`).expect(200)).body as any[];
    expect(rows.find((r) => r.id === created.id).image.id).toBe(banner.id);
    await api(app, admin).del(`${A}/promotions/${created.id}`).expect(204);
  });
});
