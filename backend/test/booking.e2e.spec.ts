import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Clock } from '../src/common/clock';
import { PrismaService } from '../src/common/prisma.service';
import { HoldsService } from '../src/holds/holds.service';
import { api, createApp, findSeats, guest, T, ticketType } from './harness';

describe('booking engine (integration)', () => {
  let app: INestApplication;
  let clock: Clock;
  let prisma: PrismaService;

  beforeAll(async () => {
    app = await createApp();
    clock = app.get(Clock);
    prisma = app.get(PrismaService);
  });
  afterEach(() => clock.reset());
  afterAll(async () => app.close());

  it('lets exactly one of many concurrent customers hold the same seats', async () => {
    const { screening, seatIds } = await findSeats(app, 2);
    const tokens = await Promise.all(Array.from({ length: 12 }, () => guest(app)));
    const results = await Promise.all(tokens.map((t) => api(app, t).post(`${T}/holds`, { screeningId: screening.id, seatIds })));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 409)).toHaveLength(11);
    for (const r of results.filter((x) => x.status === 409)) {
      expect(r.body.error.code).toBe('seats_unavailable');
      expect(r.body.error.details.seatIds.sort()).toEqual([...seatIds].sort());
    }
    const rows = await prisma.screeningSeat.findMany({ where: { screeningId: screening.id, seatId: { in: seatIds } } });
    expect(new Set(rows.map((r) => r.holdId)).size).toBe(1);
  });

  it('handles overlapping concurrent requests without deadlock or partial holds', async () => {
    const { screening, seatIds } = await findSeats(app, 4);
    const [a, b] = await Promise.all([guest(app), guest(app)]);
    // Overlapping sets requested in opposite orders.
    const [ra, rb] = await Promise.all([
      api(app, a).post(`${T}/holds`, { screeningId: screening.id, seatIds: seatIds.slice(0, 3) }),
      api(app, b).post(`${T}/holds`, { screeningId: screening.id, seatIds: [...seatIds.slice(1, 4)].reverse() }),
    ]);
    expect([ra.status, rb.status].sort()).toEqual([201, 409]);
    const held = await prisma.screeningSeat.findMany({ where: { screeningId: screening.id, seatId: { in: seatIds }, state: 'HELD' } });
    expect(held).toHaveLength(3);
  });

  it('releases expired holds so another customer can book, and refuses checkout on the expired hold', async () => {
    const { screening, seatIds } = await findSeats(app, 2, { minHoursAhead: 1 }); // the test jumps the clock 8 minutes; a screening that closes in that window would refuse the new hold
    const [a, b] = await Promise.all([guest(app), guest(app)]);
    const hold = (await api(app, a).post(`${T}/holds`, { screeningId: screening.id, seatIds }).expect(201)).body;
    const ttl = new Date(hold.expiresAt).getTime() - new Date(hold.serverTime).getTime();
    expect(ttl).toBeGreaterThan(478_000);
    expect(ttl).toBeLessThanOrEqual(480_000);

    await api(app, b).post(`${T}/holds`, { screeningId: screening.id, seatIds }).expect(409);
    clock.advance(481_000);
    // Reads treat expired holds as available even before the sweeper runs.
    const av = (await api(app).get(`${T}/screenings/${screening.id}/availability`).expect(200)).body;
    expect(seatIds.map((s) => av.seats[s])).toEqual(['available', 'available']);
    expect(await app.get(HoldsService).sweepExpired()).toBeGreaterThanOrEqual(1);
    expect((await api(app, a).get(`${T}/holds/${hold.id}`).expect(200)).body.status).toBe('EXPIRED');

    await api(app, b).post(`${T}/holds`, { screeningId: screening.id, seatIds }).expect(201);
    const adult = ticketType(screening, 'ADULT');
    const r = await api(app, a).post(`${T}/checkout`, { holdId: hold.id, tickets: seatIds.map((seatId) => ({ seatId, ticketTypeId: adult })), payment: { type: 'simulated' } });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('hold_not_active');
  });

  it('replacing a hold keeps the original expiry and frees dropped seats', async () => {
    const { screening, seatIds } = await findSeats(app, 3);
    const t = await guest(app);
    const first = (await api(app, t).post(`${T}/holds`, { screeningId: screening.id, seatIds: seatIds.slice(0, 2) }).expect(201)).body;
    clock.advance(60_000);
    const second = (await api(app, t).post(`${T}/holds`, { screeningId: screening.id, seatIds: seatIds.slice(1, 3) }).expect(201)).body;
    expect(second.expiresAt).toBe(first.expiresAt);
    const av = (await api(app).get(`${T}/screenings/${screening.id}/availability`).expect(200)).body;
    expect(av.seats[seatIds[0]]).toBe('available');
    expect(av.seats[seatIds[2]]).toBe('held');
  });

  it('confirms a booking once, replays idempotently and rejects key reuse with a different body', async () => {
    const { screening, seatIds } = await findSeats(app, 2);
    const t = await guest(app);
    const hold = (await api(app, t).post(`${T}/holds`, { screeningId: screening.id, seatIds }).expect(201)).body;
    const adult = ticketType(screening, 'ADULT');
    const body = { holdId: hold.id, tickets: seatIds.map((seatId) => ({ seatId, ticketTypeId: adult })), payment: { type: 'simulated' } };
    const key = randomUUID();
    const first = await api(app, t).post(`${T}/checkout`, body, key).expect(201);
    const replay = await api(app, t).post(`${T}/checkout`, body, key).expect(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(first.body.status).toBe('CONFIRMED');
    expect(first.body.payment.isSimulated).toBe(true);
    expect(first.body.admission.barcode).toMatch(/^CIN1\./);

    const mismatch = await api(app, t).post(`${T}/checkout`, { ...body, payment: { type: 'simulated', outcome: 'decline' } }, key);
    expect(mismatch.status).toBe(422);
    expect(mismatch.body.error.code).toBe('idempotency_mismatch');

    // A new key on a converted hold returns the same booking rather than charging again.
    const again = await api(app, t).post(`${T}/checkout`, body).expect(201);
    expect(again.body.id).toBe(first.body.id);
    expect(await prisma.payment.count({ where: { bookingId: first.body.id, status: 'CAPTURED' } })).toBe(1);
    expect(await prisma.bookingSeat.count({ where: { bookingId: first.body.id } })).toBe(2);
  });

  it('allows retry after a declined payment without losing the hold', async () => {
    const { screening, seatIds } = await findSeats(app, 1);
    const t = await guest(app);
    const hold = (await api(app, t).post(`${T}/holds`, { screeningId: screening.id, seatIds }).expect(201)).body;
    const tickets = [{ seatId: seatIds[0], ticketTypeId: ticketType(screening, 'ADULT') }];
    const declined = await api(app, t).post(`${T}/checkout`, { holdId: hold.id, tickets, payment: { type: 'simulated', outcome: 'decline' } });
    expect(declined.status).toBe(402);
    expect((await api(app).get(`${T}/screenings/${screening.id}/availability`)).body.seats[seatIds[0]]).toBe('held');
    const ok = await api(app, t).post(`${T}/checkout`, { holdId: hold.id, tickets, payment: { type: 'simulated' } }).expect(201);
    expect(ok.body.status).toBe('CONFIRMED');
  });

  it('enforces single sale per seat at the database level', async () => {
    const booked = await prisma.bookingSeat.findFirstOrThrow({ where: { active: true } });
    await expect(
      prisma.bookingSeat.create({ data: { bookingId: booked.bookingId, screeningId: booked.screeningId, seatId: booked.seatId, rowLabel: 'X', seatLabel: 'X', ticketTypeId: booked.ticketTypeId, priceMinor: 1 } }),
    ).rejects.toThrow(/Unique constraint/);
  });

  it('prices on the server with format supplements, booking fees and certificate rules', async () => {
    const { screening, seatIds } = await findSeats(app, 2, { format: 'IMAX' });
    const t = await guest(app);
    const hold = (await api(app, t).post(`${T}/holds`, { screeningId: screening.id, seatIds }).expect(201)).body;
    const adult = ticketType(screening, 'ADULT');
    const q = (await api(app, t).post(`${T}/quotes`, { holdId: hold.id, tickets: seatIds.map((seatId) => ({ seatId, ticketTypeId: adult })) }, null).expect(200)).body;
    expect(q.lines[0]).toMatchObject({ baseMinor: 1250, supplementsMinor: 400, priceMinor: 1650 });
    expect(q.feesMinor).toBe(190);
    expect(q.totalMinor).toBe(1650 * 2 + 190);

    const mismatch = await api(app, t).post(`${T}/quotes`, { holdId: hold.id, tickets: [{ seatId: seatIds[0], ticketTypeId: adult }] }, null);
    expect(mismatch.status).toBe(422);

    const adultOnly = await findSeats(app, 1, { certificate: ['15', '18'] });
    expect(adultOnly.screening.pricing.ticketTypes.map((x: any) => x.code)).not.toContain('CHILD');
  });

  it('rejects incomplete sofa selections but accepts complete pairs', async () => {
    const list = (await api(app).get(`${T}/screenings?days=7`)).body as any[];
    let det: any;
    for (const s of list) {
      const d = (await api(app).get(`${T}/screenings/${s.id}`)).body;
      const av = (await api(app).get(`${T}/screenings/${s.id}/availability`)).body;
      const sofa = d.layout.seats.filter((x: any) => x.groupId);
      const free = sofa.find((x: any) => sofa.filter((y: any) => y.groupId === x.groupId).every((y: any) => av.seats[y.id] === 'available'));
      if (free) {
        det = { d, pair: sofa.filter((y: any) => y.groupId === free.groupId).map((y: any) => y.id) };
        break;
      }
    }
    expect(det).toBeDefined();
    const t = await guest(app);
    const bad = await api(app, t).post(`${T}/holds`, { screeningId: det.d.id, seatIds: [det.pair[0]] });
    expect(bad.status).toBe(422);
    expect(bad.body.error.code).toBe('seat_rules');
    await api(app, t).post(`${T}/holds`, { screeningId: det.d.id, seatIds: det.pair }).expect(201);
  });

  it('isolates tenants', async () => {
    const t = await guest(app);
    const r = await api(app, t).get('/v1/t/kestrel/me/bookings');
    expect(r.status).toBe(403);
    const kestrelScreening = (await api(app).get('/v1/t/kestrel/screenings?days=2')).body[0];
    const cross = await api(app).get(`${T}/screenings/${kestrelScreening.id}`);
    expect(cross.status).toBe(404);
  });
});
