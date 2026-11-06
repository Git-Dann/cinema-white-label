import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Clock } from '../src/common/clock';
import { PrismaService } from '../src/common/prisma.service';
import { ensureFixtureMenuSpecials } from '../src/fixtures/menu-specials';
import { ensureFixtureProductImages } from '../src/fixtures/product-images';
import { api, createApp, findSeats, guest, T, ticketType } from './harness';

describe('food tab: specials, film tie-ins and pre-ordering for a booking (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: string;
  const A = '/v1/admin/t/northlight';

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    admin = (await request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email: 'admin@northlight.example', password: 'operator-dev-password' }).expect(200)).body.token;
  });
  afterEach(() => app.get(Clock).reset());
  afterAll(async () => app.close());

  async function menu(venueId: string) {
    return (await api(app).get(`${T}/venues/${venueId}/concessions`).expect(200)).body.categories.flatMap((c: any) => c.items) as any[];
  }

  async function booked(opts: { minHoursAhead?: number } = {}) {
    const { screening, seatIds } = await findSeats(app, 1, { venueName: 'Leeds', minHoursAhead: opts.minHoursAhead ?? 2 });
    const token = await guest(app);
    const hold = (await api(app, token).post(`${T}/holds`, { screeningId: screening.id, seatIds }).expect(201)).body;
    const tickets = seatIds.map((seatId) => ({ seatId, ticketTypeId: ticketType(screening, 'ADULT') }));
    const booking = (await api(app, token).post(`${T}/checkout`, { holdId: hold.id, tickets, payment: { type: 'simulated' } }).expect(201)).body;
    return { screening, token, booking, items: await menu(screening.venue.id) };
  }

  it('shows specials, bundle savings, limited editions and film tie-ins on the menu', async () => {
    const leeds = (await api(app).get(`${T}/venues/leeds-riverside`).expect(200)).body;
    const items = await menu(leeds.id);
    const bucket = items.find((i) => i.sku === 'EMBER-BUCKET');
    expect(bucket).toMatchObject({ featured: true, limitedEdition: true, badge: 'Limited edition', film: { title: 'Ember Protocol' }, compareAtMinor: null });
    expect(bucket.image?.url).toBeTruthy();
    expect(items.find((i) => i.sku === 'COMBO-FAMILY')).toMatchObject({ featured: true, compareAtMinor: 2790, priceMinor: 2295 });
    expect(items.find((i) => i.sku === 'COMBO-DUO')).toMatchObject({ featured: true, compareAtMinor: 1745 });
    expect(items.find((i) => i.sku === 'POP-SALT')).toMatchObject({ featured: false, film: null, limitedEdition: false });
  });

  it('hides products outside their sale window and refuses to sell them', async () => {
    const { booking, token, items } = await booked();
    const choc = items.find((i) => i.sku === 'HOT-CHOC');
    await prisma.concessionProduct.update({ where: { id: choc.id }, data: { availableUntil: new Date(Date.now() - 60_000) } });
    try {
      expect((await menu(booking.venue.id)).some((i) => i.sku === 'HOT-CHOC')).toBe(false);
      const res = await api(app, token).post(`${T}/bookings/${booking.id}/concessions/quote`, { concessions: [{ productId: choc.id, quantity: 1 }] }, null);
      expect(res.status).toBe(422);
      expect(res.body.error.code).toBe('concession_unavailable');
    } finally {
      await prisma.concessionProduct.update({ where: { id: choc.id }, data: { availableUntil: null } });
    }
  });

  it('pre-orders food for a booking: priced on the server, paid once per key, points earned, shown on the ticket', async () => {
    const { booking, token, items } = await booked();
    const bucket = items.find((i) => i.sku === 'EMBER-BUCKET');
    const choc = items.find((i) => i.sku === 'HOT-CHOC');
    const body = { concessions: [{ productId: bucket.id, quantity: 1, modifiers: { popcorn: ['salted'] } }, { productId: choc.id, quantity: 2, modifiers: { toppings: ['marshmallows'] } }] };
    expect(booking.preorder.open).toBe(true);

    const q = (await api(app, token).post(`${T}/bookings/${booking.id}/concessions/quote`, body, null).expect(200)).body;
    expect(q).toMatchObject({ subtotalMinor: 1295 + 2 * 445, discountMinor: 0, totalMinor: 2185, fulfilment: 'collect', pointsToEarn: Math.floor((2185 * 10) / 100) });

    const missingKey = await api(app, token).post(`${T}/bookings/${booking.id}/concessions`, { ...body, payment: { type: 'simulated' } }, null);
    expect(missingKey.status).toBe(400);

    const declined = await api(app, token).post(`${T}/bookings/${booking.id}/concessions`, { ...body, payment: { type: 'simulated', outcome: 'decline' } });
    expect(declined.status).toBe(402);

    const key = randomUUID();
    const after = (await api(app, token).post(`${T}/bookings/${booking.id}/concessions`, { ...body, payment: { type: 'simulated' } }, key).expect(201)).body;
    await api(app, token).post(`${T}/bookings/${booking.id}/concessions`, { ...body, payment: { type: 'simulated' } }, key).expect(201);
    expect(after.concessions.map((c: any) => c.name)).toEqual(['Ember Protocol collectable bucket', 'Hot chocolate']);
    expect(after.totals.concessionsMinor).toBe(2185);
    expect(after.totals.totalMinor).toBe(booking.totals.totalMinor + 2185);
    expect(after.totals.pointsEarned).toBe(booking.totals.pointsEarned + q.pointsToEarn);
    const payments = await prisma.payment.findMany({ where: { bookingId: booking.id, status: 'CAPTURED' } });
    expect(payments.map((p) => p.amountMinor).sort((a, b) => a - b)).toEqual([2185, booking.totals.totalMinor].sort((a, b) => a - b));

    // Cancelling refunds the tickets and the food separately.
    const cancelled = (await api(app, token).post(`${T}/bookings/${booking.id}/cancel`, {}, null).expect(200)).body;
    expect(cancelled.status).toBe('REFUNDED');
    expect(cancelled.cancellation.refundedMinor).toBe(booking.totals.totalMinor + 2185);
    expect(await prisma.refund.count({ where: { bookingId: booking.id } })).toBe(2);
    const late = await api(app, token).post(`${T}/bookings/${booking.id}/concessions/quote`, body, null);
    expect(late.status).toBe(422);
  });

  it('applies the member food discount and closes pre-orders 15 minutes before the film', async () => {
    const { booking, token, items, screening } = await booked();
    const plans = (await api(app).get(`${T}/membership/plans`)).body;
    const premiere = plans.find((p: any) => p.name === 'Northlight Premiere');
    await api(app, token).post(`${T}/me/membership`, { planId: premiere.id, payment: { type: 'simulated' } }).expect(201);
    const family = items.find((i) => i.sku === 'COMBO-FAMILY');
    const body = { concessions: [{ productId: family.id, quantity: 1, modifiers: { popcorn: ['sweet', 'salted'] } }] };
    const q = (await api(app, token).post(`${T}/bookings/${booking.id}/concessions/quote`, body, null).expect(200)).body;
    expect(q.discountMinor).toBe(Math.floor(2295 * 0.15));
    expect(q.totalMinor).toBe(2295 - Math.floor(2295 * 0.15));
    expect(q.discounts[0].label).toBe('Northlight Premiere member discount');

    // Someone else cannot add to this booking.
    const other = await guest(app);
    expect((await api(app, other).post(`${T}/bookings/${booking.id}/concessions/quote`, body, null)).status).toBe(404);

    const startsAt = new Date(screening.startsAt).getTime();
    app.get(Clock).advance(startsAt - Date.now() - 10 * 60_000);
    const closed = await api(app, token).post(`${T}/bookings/${booking.id}/concessions/quote`, body, null);
    expect(closed.status).toBe(422);
    expect(closed.body.error.message).toContain('15 minutes before');
    expect((await api(app, token).get(`${T}/bookings/${booking.id}`)).body.preorder.open).toBe(false);
  });

  it('lets operators manage specials, with checks on the "was" price, sale window and film', async () => {
    const auth = (r: request.Test) => r.set('Authorization', `Bearer ${admin}`);
    const film = await prisma.film.findFirstOrThrow({ where: { slug: 'tidewater', tenant: { slug: 'northlight' } } });
    const base = { sku: `CUP-${Date.now() % 100000}`, name: 'Tidewater cup', category: 'Merchandise', priceMinor: 895 };
    const bad = await auth(request(app.getHttpServer()).post(`${A}/concessions`)).send({ ...base, compareAtMinor: 800 });
    expect(bad.status).toBe(422);
    const window = await auth(request(app.getHttpServer()).post(`${A}/concessions`)).send({ ...base, availableFrom: '2026-12-01T00:00:00.000Z', availableUntil: '2026-11-01T00:00:00.000Z' });
    expect(window.status).toBe(422);
    const created = (await auth(request(app.getHttpServer()).post(`${A}/concessions`)).send({ ...base, featured: true, limitedEdition: true, badge: 'Limited edition', filmId: film.id, compareAtMinor: 1095 }).expect(201)).body;
    expect(created).toMatchObject({ featured: true, limitedEdition: true, filmId: film.id, compareAtMinor: 1095 });
    const upd = await auth(request(app.getHttpServer()).put(`${A}/concessions/${created.id}`)).send({ priceMinor: 1200 });
    expect(upd.status).toBe(422);
    const foreign = await prisma.film.findFirstOrThrow({ where: { tenant: { slug: 'kestrel' } } });
    expect((await auth(request(app.getHttpServer()).put(`${A}/concessions/${created.id}`)).send({ filmId: foreign.id })).status).toBe(404);
    await auth(request(app.getHttpServer()).delete(`${A}/concessions/${created.id}`)).expect(204);
  });

  it('adds the demo specials to existing operators once, and never again after they curate their own', async () => {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'kestrel' } });
    const skus = ['EMBER-BUCKET', 'TIDE-CARAMEL', 'HOT-CHOC', 'COMBO-FAMILY'];
    const saved = await prisma.concessionProduct.findMany({ where: { tenantId: tenant.id, featured: true } });
    await prisma.concessionProduct.deleteMany({ where: { tenantId: tenant.id, sku: { in: skus } } });
    await prisma.concessionProduct.updateMany({ where: { tenantId: tenant.id }, data: { featured: false } });

    expect(await ensureFixtureMenuSpecials(prisma as any)).toBe(4);
    expect(await prisma.concessionProduct.count({ where: { tenantId: tenant.id, sku: { in: skus } } })).toBe(4);
    await prisma.concessionProduct.deleteMany({ where: { tenantId: tenant.id, sku: 'EMBER-BUCKET' } });
    expect(await ensureFixtureMenuSpecials(prisma as any)).toBe(0);
    expect(await prisma.concessionProduct.count({ where: { tenantId: tenant.id, sku: 'EMBER-BUCKET' } })).toBe(0);
    // Put Kestrel back as the seed left it.
    await prisma.concessionProduct.deleteMany({ where: { tenantId: tenant.id, sku: { in: skus } } });
    await prisma.concessionProduct.updateMany({ where: { tenantId: tenant.id }, data: { featured: false } });
    await ensureFixtureMenuSpecials(prisma as any);
    await ensureFixtureProductImages(prisma as any);
    expect(saved.length).toBeGreaterThan(0);
  });
});
