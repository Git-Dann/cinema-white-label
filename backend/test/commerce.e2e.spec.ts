import { INestApplication } from '@nestjs/common';
import { Clock } from '../src/common/clock';
import { PrismaService } from '../src/common/prisma.service';
import { api, createApp, findSeats, guest, T, ticketType } from './harness';

describe('seat categories, food and drink, vouchers and cancellation (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });
  afterEach(() => app.get(Clock).reset());
  afterAll(async () => app.close());

  async function venue(slug: string, tenant = 'northlight') {
    return (await api(app).get(`/v1/t/${tenant}/venues/${slug}`).expect(200)).body;
  }

  async function menuItem(venueId: string, sku: string) {
    const menu = (await api(app).get(`${T}/venues/${venueId}/concessions`).expect(200)).body;
    return menu.categories.flatMap((c: any) => c.items).find((i: any) => i.sku === sku);
  }

  async function holdFor(n = 1) {
    const { screening, seatIds } = await findSeats(app, n, { venueName: 'Leeds' });
    const token = await guest(app);
    const hold = (await api(app, token).post(`${T}/holds`, { screeningId: screening.id, seatIds }).expect(201)).body;
    const tickets = seatIds.map((seatId) => ({ seatId, ticketTypeId: ticketType(screening, 'ADULT') }));
    return { screening, seatIds, token, hold, tickets };
  }

  it('delivers operator seat categories and rules with the screening', async () => {
    const list = (await api(app).get(`${T}/screenings?days=7`)).body as any[];
    const premiere = list.find((s) => s.auditorium.name.includes('Premiere'));
    const det = (await api(app).get(`${T}/screenings/${premiere.id}`).expect(200)).body;
    expect(det.seatCategories.map((c: any) => c.id).sort()).toEqual(['luxe-pod', 'vip-bed']);
    expect(det.seatCategories.find((c: any) => c.id === 'vip-bed')).toMatchObject({ label: 'VIP Bed', shape: 'bed', icon: 'bed.double.fill' });
    expect(det.seatRules).toEqual({ maxTickets: 10, orphanSeatPolicy: 'warn', companionPolicy: 'warn' });
    expect(det.pricing.ticketTypes.find((t: any) => t.code === 'ADULT').prices['vip-bed']).toBe(3495);

    const kestrel = (await api(app).get('/v1/t/kestrel/screenings?days=7')).body[0];
    const kd = (await api(app).get(`/v1/t/kestrel/screenings/${kestrel.id}`)).body;
    expect(kd.seatRules.companionPolicy).toBe('requireWheelchair');
  });

  it('respects location-level feature flags for food and drink', async () => {
    const york = await venue('york-walls');
    expect(york.features).toEqual({ concessions: false, seatDelivery: false });
    const menu = (await api(app).get(`${T}/venues/${york.id}/concessions`).expect(200)).body;
    expect(menu.categories).toEqual([]);
    const leeds = await venue('leeds-riverside');
    expect(leeds.features.seatDelivery).toBe(true);
  });

  it('prices food with modifiers and validates choices on the server', async () => {
    const { screening, token, hold, tickets } = await holdFor();
    const venueId = screening.venue.id;
    const combo = await menuItem(venueId, 'COMBO-DUO');
    const q = (await api(app, token).post(`${T}/quotes`, {
      holdId: hold.id, tickets,
      concessions: [{ productId: combo.id, quantity: 1, modifiers: { popcorn: ['mix'], drinks: ['cola', 'water'] } }],
    }, null).expect(200)).body;
    expect(q.concessions[0]).toMatchObject({ unitPriceMinor: 1645, lineTotalMinor: 1645 });
    expect(q.totalMinor).toBe(q.subtotalMinor + q.feesMinor + 1645);

    const missing = await api(app, token).post(`${T}/quotes`, { holdId: hold.id, tickets, concessions: [{ productId: combo.id, quantity: 1, modifiers: { popcorn: ['mix'] } }] }, null);
    expect(missing.status).toBe(422);
    expect(missing.body.error.message).toContain('choose 2 drinks');

    const soldOut = await menuItem(venueId, 'ICECREAM');
    const out = await api(app, token).post(`${T}/quotes`, { holdId: hold.id, tickets, concessions: [{ productId: soldOut.id, quantity: 1 }] }, null);
    expect(out.status).toBe(422);
    expect(out.body.error.code).toBe('concession_unavailable');
  });

  it('applies vouchers to the right part of the basket and enforces single use', async () => {
    const a = await holdFor();
    const popcorn = await menuItem(a.screening.venue.id, 'POP-SALT');
    const food = [{ productId: popcorn.id, quantity: 1, modifiers: { size: ['regular'] } }];
    const q = (await api(app, a.token).post(`${T}/quotes`, { holdId: a.hold.id, tickets: a.tickets, concessions: food, voucherCode: 'popcorn2' }, null).expect(200)).body;
    expect(q.voucher).toMatchObject({ code: 'POPCORN2', discountMinor: 200 });
    const noFood = await api(app, a.token).post(`${T}/quotes`, { holdId: a.hold.id, tickets: a.tickets, voucherCode: 'POPCORN2' }, null);
    expect(noFood.body.error.code).toBe('voucher_invalid');

    const first = await api(app, a.token).post(`${T}/checkout`, { holdId: a.hold.id, tickets: a.tickets, voucherCode: 'LASTONE', payment: { type: 'simulated' } }).expect(201);
    expect(first.body.totals.discountMinor).toBe(500);
    const b = await holdFor();
    const second = await api(app, b.token).post(`${T}/quotes`, { holdId: b.hold.id, tickets: b.tickets, voucherCode: 'LASTONE' }, null);
    expect(second.status).toBe(422);
    expect(second.body.error.message).toContain('fully used');
  });

  it('stores food lines and fulfilment on the booking', async () => {
    const { screening, token, hold, tickets } = await holdFor();
    const drink = await menuItem(screening.venue.id, 'DRINK');
    const body = { holdId: hold.id, tickets, concessions: [{ productId: drink.id, quantity: 2, modifiers: { size: ['large'], drink: ['lemonade'] } }], fulfilment: 'seatDelivery', payment: { type: 'simulated' } };
    const b = (await api(app, token).post(`${T}/checkout`, body).expect(201)).body;
    expect(b.concessions).toEqual([{ name: 'Fountain drink', quantity: 2, modifiers: ['Large', 'Sparkling lemonade'], lineTotalMinor: (450 + 135) * 2 }]);
    expect(b.fulfilment).toBe(body.fulfilment);
    expect(b.totals.concessionsMinor).toBe(1170);
  });

  it('cancels within the cutoff: refunds, frees seats and voids the ticket', async () => {
    const { screening, seatIds, token, hold, tickets } = await holdFor(2);
    const booking = (await api(app, token).post(`${T}/checkout`, { holdId: hold.id, tickets, payment: { type: 'simulated' } }).expect(201)).body;
    expect(booking.cancellation.canCancel).toBe(true);
    const cancelled = (await api(app, token).post(`${T}/bookings/${booking.id}/cancel`, {}, null).expect(200)).body;
    expect(cancelled.status).toBe('REFUNDED');
    expect(cancelled.cancellation.refundedMinor).toBe(booking.totals.totalMinor);
    const av = (await api(app).get(`${T}/screenings/${screening.id}/availability`)).body;
    expect(seatIds.map((s) => av.seats[s])).toEqual(['available', 'available']);
    expect((await prisma.admissionTicket.findFirstOrThrow({ where: { bookingId: booking.id } })).status).toBe('VOID');
    // Seats can be sold again despite the earlier BookingSeat rows.
    const other = await guest(app);
    const h2 = (await api(app, other).post(`${T}/holds`, { screeningId: screening.id, seatIds }).expect(201)).body;
    await api(app, other).post(`${T}/checkout`, { holdId: h2.id, tickets, payment: { type: 'simulated' } }).expect(201);
  });

  it('refuses cancellation after the cutoff', async () => {
    const { screening, token, hold, tickets } = await holdFor();
    const booking = (await api(app, token).post(`${T}/checkout`, { holdId: hold.id, tickets, payment: { type: 'simulated' } }).expect(201)).body;
    app.get(Clock).advance(new Date(screening.startsAt).getTime() - Date.now() - 30 * 60000);
    const r = await api(app, token).post(`${T}/bookings/${booking.id}/cancel`, {}, null);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('cancellation_not_allowed');
  });
});
