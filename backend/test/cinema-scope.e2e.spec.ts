import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { api, createApp, findSeats, guest, T, ticketType } from './harness';

describe('per-cinema vouchers and stats (integration)', () => {
  let app: INestApplication;
  let admin: string;
  const A = '/v1/admin/t/northlight';

  beforeAll(async () => {
    app = await createApp();
    admin = (await request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email: 'admin@northlight.example', password: 'operator-dev-password' }).expect(200)).body.token;
  });
  afterAll(async () => app.close());

  async function quoteAt(venueName: string, voucherCode: string) {
    const { screening, seatIds } = await findSeats(app, 1, { venueName, minHoursAhead: 2 });
    const token = await guest(app);
    const hold = (await api(app, token).post(`${T}/holds`, { screeningId: screening.id, seatIds }).expect(201)).body;
    const tickets = seatIds.map((seatId) => ({ seatId, ticketTypeId: ticketType(screening, 'ADULT') }));
    return api(app, token).post(`${T}/quotes`, { holdId: hold.id, tickets, voucherCode }, null);
  }

  it('limits a voucher to one cinema', async () => {
    const venues = (await api(app, admin).get(`${A}/venues`).expect(200)).body as any[];
    const leeds = venues.find((v) => v.name.includes('Leeds'));
    await api(app, admin).post(`${A}/vouchers`, { code: 'LEEDSONLY', description: 'Leeds launch', kind: 'amountOff', value: 200, appliesTo: 'tickets', venueId: leeds.id }).expect(201);

    const there = await quoteAt('Leeds', 'LEEDSONLY');
    expect(there.status).toBe(200);
    expect(there.body.discounts?.find?.((d: any) => d.kind === 'voucher') ?? there.body.voucher).toBeTruthy();

    const elsewhere = await quoteAt('Manchester', 'LEEDSONLY');
    expect(elsewhere.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(elsewhere.body)).toContain('can only be used at Northlight Leeds Riverside');
  });

  it('refuses a cinema from another operator', async () => {
    const kestrel = (await api(app).get('/v1/t/kestrel/venues').expect(200)).body as any[];
    await api(app, admin).post(`${A}/vouchers`, { code: 'NOTOURS', description: 'x', kind: 'amountOff', value: 100, venueId: kestrel[0].id }).expect(404);
  });

  it('reports stats for one cinema', async () => {
    const venues = (await api(app, admin).get(`${A}/venues`).expect(200)).body as any[];
    const all = (await api(app, admin).get(`${A}/stats`).expect(200)).body;
    const per = await Promise.all(venues.map(async (v) => (await api(app, admin).get(`${A}/stats?venueId=${v.id}`).expect(200)).body));
    expect(per.reduce((a, s) => a + s.bookings, 0)).toBe(all.bookings);
    await api(app, admin).get(`${A}/stats?venueId=nope`).expect(404);
  });
});
