import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { api, createApp, T } from './harness';
import { ensureFixtureVenueImages } from '../src/fixtures/venue-images';

describe('cinema photos (integration)', () => {
  let app: INestApplication;
  let admin: string;
  const A = '/v1/admin/t/northlight';
  const prisma = new PrismaClient();
  // A 1x1 JPEG, enough for the upload pipeline to accept and measure.
  const PIXEL = '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/yQALCAABAAEBAREA/8wABgAQEAX/2gAIAQEAAD8A0s8g/9k=';

  beforeAll(async () => {
    app = await createApp();
    admin = (await request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email: 'admin@northlight.example', password: 'operator-dev-password' }).expect(200)).body.token;
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('gives demo cinemas a photo once, and the admin and app lists return it', async () => {
    await ensureFixtureVenueImages(prisma as any);
    expect(await ensureFixtureVenueImages(prisma as any)).toBe(0); // never touches a cinema that has one
    const venues = (await api(app, admin).get(`${A}/venues`).expect(200)).body as any[];
    const leeds = venues.find((v) => v.slug === 'leeds-riverside');
    expect(leeds.image).toMatchObject({ width: 1200, height: 900 });
    expect(leeds.image.url).toMatch(/^\/v1\/media\//);
    const app_ = (await request(app.getHttpServer()).get(`${T}/venues`).expect(200)).body as any[];
    expect(app_.find((v) => v.slug === 'leeds-riverside').image.id).toBe(leeds.image.id);
  });

  it('only accepts a photo uploaded for a cinema, from this operator', async () => {
    const venues = (await api(app, admin).get(`${A}/venues`).expect(200)).body as any[];
    const york = venues.find((v) => v.slug === 'york-walls');
    const product = (await api(app, admin).post(`${A}/media`, { kind: 'PRODUCT', dataBase64: PIXEL }).expect(201)).body;
    await api(app, admin).put(`${A}/venues/${york.id}`, { imageAssetId: product.id }).expect(422);

    const photo = (await api(app, admin).post(`${A}/media`, { kind: 'VENUE', dataBase64: PIXEL }).expect(201)).body;
    const saved = (await api(app, admin).put(`${A}/venues/${york.id}`, { imageAssetId: photo.id }).expect(200)).body;
    expect(saved.image.id).toBe(photo.id);

    const kestrel = (await request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email: 'admin@kestrel.example', password: 'operator-dev-password' })).body.token;
    const kVenue = ((await api(app, kestrel).get('/v1/admin/t/kestrel/venues').expect(200)).body as any[])[0];
    await api(app, kestrel).put(`/v1/admin/t/kestrel/venues/${kVenue.id}`, { imageAssetId: photo.id }).expect(422);

    // Removing the photo is allowed.
    expect((await api(app, admin).put(`${A}/venues/${york.id}`, { imageAssetId: null }).expect(200)).body.image).toBeNull();
  });
});
