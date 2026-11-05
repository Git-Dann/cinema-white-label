import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'crypto';
import { Clock } from '../src/common/clock';
import { PrismaService } from '../src/common/prisma.service';
import { addInterval, LoyaltyService, PointsMath } from '../src/loyalty/loyalty.service';
import { api, createApp, findSeats, guest, T, ticketType } from './harness';

describe('points maths (unit)', () => {
  const program = { earnPointsPerPound: 10, redeemPointsPerPound: 200, minRedeemPoints: 200 };

  it('earns on what was paid, rounding down, with the membership multiplier', () => {
    expect(PointsMath.earn(program, 2599)).toBe(259);
    expect(PointsMath.earn(program, 2599, 1.5)).toBe(389);
    expect(PointsMath.earn(program, 0)).toBe(0);
  });

  it('caps redemption by balance and order value, in whole pounds', () => {
    expect(PointsMath.maxRedeemable(program, 1050, 10_000)).toBe(1000);
    expect(PointsMath.maxRedeemable(program, 5000, 750)).toBe(1400);
    expect(PointsMath.maxRedeemable(program, 150, 10_000)).toBe(0);
    const reason = (fn: () => unknown) => {
      try {
        fn();
      } catch (e) {
        return (e as any).getResponse().error.message as string;
      }
      return 'no error';
    };
    expect(reason(() => PointsMath.redeem(program, 1000, 300, 10_000))).toContain('steps of 200');
    expect(reason(() => PointsMath.redeem(program, 1000, 1200, 10_000))).toBe('You have 1000 points');
    expect(reason(() => PointsMath.redeem(program, 1000, 400, 150))).toContain('more points than this order needs');
    expect(PointsMath.redeem(program, 1000, 400, 10_000)).toEqual({ points: 400, discountMinor: 200 });
  });

  it('adds billing intervals without overflowing short months', () => {
    expect(addInterval(new Date('2026-01-31T10:00:00Z'), 'month').toISOString()).toBe('2026-02-28T10:00:00.000Z');
    expect(addInterval(new Date('2028-01-31T10:00:00Z'), 'month').toISOString()).toBe('2028-02-29T10:00:00.000Z');
    expect(addInterval(new Date('2026-11-05T10:00:00Z'), 'month').toISOString()).toBe('2026-12-05T10:00:00.000Z');
    expect(addInterval(new Date('2028-02-29T10:00:00Z'), 'year').toISOString()).toBe('2029-02-28T10:00:00.000Z');
  });
});

describe('loyalty and memberships (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let admin: string;
  let editor: string;
  const A = '/v1/admin/t/northlight';

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    const login = (email: string, password: string) => request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email, password }).expect(200);
    admin = (await login('admin@northlight.example', 'operator-dev-password')).body.token;
    editor = (await login('editor@northlight.example', 'editor-dev-password')).body.token;
  });
  afterEach(() => app.get(Clock).reset());
  afterAll(async () => app.close());

  async function holdFor(token: string, n = 1) {
    // Two hours ahead keeps every booking inside the cancellation window.
    const { screening, seatIds } = await findSeats(app, n, { venueName: 'Leeds', format: '2D', minHoursAhead: 2 });
    const hold = (await api(app, token).post(`${T}/holds`, { screeningId: screening.id, seatIds }).expect(201)).body;
    const tickets = seatIds.map((seatId) => ({ seatId, ticketTypeId: ticketType(screening, 'ADULT') }));
    return { screening, hold, tickets };
  }
  async function customerOf(holdId: string) {
    return (await prisma.seatHold.findUniqueOrThrow({ where: { id: holdId } })).customerId;
  }
  async function setPoints(customerId: string, points: number) {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'northlight' } });
    await prisma.loyaltyAccount.upsert({ where: { customerId }, create: { tenantId: tenant.id, customerId, points }, update: { points } });
  }
  const checkout = (token: string, body: object, key = randomUUID()) => api(app, token).post(`${T}/checkout`, { payment: { type: 'simulated' }, ...body }, key);

  it('publishes the scheme and plans for operators that have them', async () => {
    const plans = (await api(app).get(`${T}/membership/plans`).expect(200)).body;
    expect(plans.map((p: any) => p.name)).toEqual(['Northlight Plus', 'Northlight Premiere']);
    expect(plans[0].entitlements).toEqual({ ticketDiscountPercent: 10, foodDiscountPercent: 10, bookingFeeWaived: true, pointsMultiplier: 1.5 });
    expect((await api(app).get('/v1/t/kestrel/membership/plans').expect(200)).body).toEqual([]);

    const token = await guest(app);
    const summary = (await api(app, token).get(`${T}/loyalty`).expect(200)).body;
    expect(summary).toMatchObject({ program: { name: 'Northlight Rewards', earnPointsPerPound: 10, redeemPointsPerPound: 200 }, points: 0, history: [] });
    const k = (await api(app, await guest(app, 'kestrel')).get('/v1/t/kestrel/loyalty').expect(200)).body;
    expect(k.program).toBeNull();
  });

  it('earns points on confirmation and shows them in the history', async () => {
    const token = await guest(app);
    const { hold, tickets } = await holdFor(token, 2);
    const quote = (await api(app, token).post(`${T}/quotes`, { holdId: hold.id, tickets }, null).expect(200)).body;
    expect(quote.loyalty.pointsToEarn).toBe(Math.floor((quote.subtotalMinor * 10) / 100));
    expect(quote.loyalty.maxRedeemablePoints).toBe(0);

    const booking = (await checkout(token, { holdId: hold.id, tickets }).expect(201)).body;
    expect(booking.totals.pointsEarned).toBe(quote.loyalty.pointsToEarn);
    const summary = (await api(app, token).get(`${T}/loyalty`)).body;
    expect(summary.points).toBe(quote.loyalty.pointsToEarn);
    expect(summary.history[0]).toMatchObject({ reason: 'earn', points: quote.loyalty.pointsToEarn, bookingId: booking.id, balanceAfter: quote.loyalty.pointsToEarn });
  });

  it('redeems points in whole pounds and validates on the server', async () => {
    const token = await guest(app);
    const { hold, tickets } = await holdFor(token);
    await setPoints(await customerOf(hold.id), 1000);

    const bad = (pts: number) => api(app, token).post(`${T}/quotes`, { holdId: hold.id, tickets, loyaltyPoints: pts }, null);
    expect((await bad(150)).body.error.code).toBe('points_invalid');
    expect((await bad(1200)).body.error.message).toBe('You have 1000 points');

    const plain = (await bad(0)).body;
    const quote = (await bad(400).expect(200)).body;
    expect(quote.loyalty).toMatchObject({ balance: 1000, pointsRedeemed: 400, pointsDiscountMinor: 200 });
    expect(quote.discounts).toEqual([{ kind: 'points', label: '400 points', amountMinor: 200 }]);
    expect(quote.totalMinor).toBe(plain.totalMinor - 200);
    // Points are earned on what is paid in money, booking fees excluded.
    expect(quote.loyalty.pointsToEarn).toBe(Math.floor(((quote.subtotalMinor - 200) * 10) / 100));

    const booking = (await checkout(token, { holdId: hold.id, tickets, loyaltyPoints: 400 }).expect(201)).body;
    expect(booking.totals).toMatchObject({ pointsRedeemed: 400, pointsDiscountMinor: 200, totalMinor: quote.totalMinor });
    const summary = (await api(app, token).get(`${T}/loyalty`)).body;
    expect(summary.points).toBe(1000 - 400 + quote.loyalty.pointsToEarn);
    expect(summary.history.map((h: any) => h.reason).sort()).toEqual(['earn', 'redeem']);
  });

  it('never lets the same points be spent twice, even concurrently', async () => {
    // A customer holds one reservation at a time, so race the redemption itself.
    const token = await guest(app);
    const { hold } = await holdFor(token);
    const customerId = await customerOf(hold.id);
    const tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'northlight' } })).id;
    await setPoints(customerId, 400);
    const loyalty = app.get(LoyaltyService);
    const spend = (bookingId: string) =>
      prisma.$transaction((tx) => loyalty.applyCheckout(tx, { tenantId, customerId, bookingId, redeem: 400, earn: 0, description: 'race' }));
    const results = await Promise.allSettled([spend('race-a'), spend('race-b')]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(((results.find((r) => r.status === 'rejected') as PromiseRejectedResult).reason.getResponse() as any).error.code).toBe('points_invalid');
    const account = await prisma.loyaltyAccount.findUniqueOrThrow({ where: { customerId }, include: { entries: true } });
    expect(account.points).toBe(0);
    expect(account.entries.filter((e) => e.reason === 'redeem')).toHaveLength(1);
    await api(app, token).del(`${T}/holds/${hold.id}`);
  });

  it('gives back spent points and takes back earned ones on cancellation', async () => {
    const token = await guest(app);
    const { hold, tickets } = await holdFor(token);
    const customerId = await customerOf(hold.id);
    await setPoints(customerId, 600);
    const booking = (await checkout(token, { holdId: hold.id, tickets, loyaltyPoints: 400 }).expect(201)).body;
    const earned = booking.totals.pointsEarned;
    expect((await api(app, token).get(`${T}/loyalty`)).body.points).toBe(200 + earned);

    await api(app, token).post(`${T}/bookings/${booking.id}/cancel`, {}, null).expect(200);
    const summary = (await api(app, token).get(`${T}/loyalty`)).body;
    expect(summary.points).toBe(600);
    expect(summary.history.slice(0, 2).map((h: any) => h.reason).sort()).toEqual(['refund_redeem', 'reverse_earn']);
  });

  describe('memberships', () => {
    let plus: any;
    let premiere: any;
    beforeAll(async () => {
      const plans = (await api(app).get(`${T}/membership/plans`)).body;
      plus = plans.find((p: any) => p.name === 'Northlight Plus');
      premiere = plans.find((p: any) => p.name === 'Northlight Premiere');
    });

    it('sells a membership with a simulated payment and applies its benefits at quote time', async () => {
      const token = await guest(app);
      expect((await api(app, token).get(`${T}/me/membership`).expect(200)).body.membership).toBeNull();

      const declined = await api(app, token).post(`${T}/me/membership`, { planId: plus.id, payment: { type: 'simulated', outcome: 'decline' } });
      expect(declined.status).toBe(402);
      expect((await api(app, token).get(`${T}/me/membership`)).body.membership).toBeNull();

      const key = randomUUID();
      const bought = (await api(app, token).post(`${T}/me/membership`, { planId: plus.id, payment: { type: 'simulated' } }, key).expect(201)).body;
      expect(bought).toMatchObject({ status: 'active', renewal: 'manual', plan: { name: 'Northlight Plus' }, payment: { simulated: true, amountMinor: 699 } });
      // Retrying with the same key does not charge again.
      const again = (await api(app, token).post(`${T}/me/membership`, { planId: plus.id, payment: { type: 'simulated' } }, key).expect(201)).body;
      expect(again.currentPeriodEnd).toBe(bought.currentPeriodEnd);
      const membership = await prisma.membership.findFirstOrThrow({ where: { planId: plus.id }, orderBy: { createdAt: 'desc' } });
      expect(await prisma.membershipPurchase.count({ where: { membershipId: membership.id } })).toBe(1);

      const { hold, tickets } = await holdFor(token, 2);
      const quote = (await api(app, token).post(`${T}/quotes`, { holdId: hold.id, tickets }, null).expect(200)).body;
      const ticketDiscount = Math.floor(quote.subtotalMinor * 0.1);
      expect(quote.feesMinor).toBe(0);
      expect(quote.membership).toMatchObject({ planName: 'Northlight Plus', discountMinor: ticketDiscount });
      expect(quote.membership.feeWaivedMinor).toBeGreaterThan(0);
      expect(quote.totalMinor).toBe(quote.subtotalMinor - ticketDiscount);
      expect(quote.loyalty.pointsToEarn).toBe(Math.floor(((quote.subtotalMinor - ticketDiscount) * 10 * 1.5) / 100));

      const booking = (await checkout(token, { holdId: hold.id, tickets }).expect(201)).body;
      expect(booking.totals).toMatchObject({ membershipPlanName: 'Northlight Plus', membershipDiscountMinor: ticketDiscount, feesMinor: 0 });
    });

    it('renews by extending the period and refuses a plan switch mid-period', async () => {
      const token = await guest(app);
      const first = (await api(app, token).post(`${T}/me/membership`, { planId: plus.id, payment: { type: 'simulated' } }).expect(201)).body;
      const sw = await api(app, token).post(`${T}/me/membership`, { planId: premiere.id, payment: { type: 'simulated' } });
      expect(sw.status).toBe(409);
      expect(sw.body.error.code).toBe('membership_not_allowed');
      const renewed = (await api(app, token).post(`${T}/me/membership`, { planId: plus.id, payment: { type: 'simulated' } }).expect(201)).body;
      expect(renewed.currentPeriodEnd).toBe(addInterval(new Date(first.currentPeriodEnd), 'month').toISOString());
      expect(renewed.startedAt).toBe(first.startedAt);
    });

    it('stops applying benefits once the period ends, and then allows a different plan', async () => {
      const token = await guest(app);
      await api(app, token).post(`${T}/me/membership`, { planId: plus.id, payment: { type: 'simulated' } }).expect(201);
      app.get(Clock).advance(32 * 86_400_000);
      expect((await api(app, token).get(`${T}/me/membership`)).body.membership.status).toBe('expired');
      const sw = (await api(app, token).post(`${T}/me/membership`, { planId: premiere.id, payment: { type: 'simulated' } }).expect(201)).body;
      expect(sw.plan.name).toBe('Northlight Premiere');
    });

    it('is tenant-scoped', async () => {
      const k = await guest(app, 'kestrel');
      expect((await api(app, k).post('/v1/t/kestrel/me/membership', { planId: plus.id, payment: { type: 'simulated' } })).status).toBe(404);
    });
  });

  describe('admin', () => {
    it('edits the scheme with sanity checks, operator admins only', async () => {
      const current = (await api(app, admin).get(`${A}/loyalty`).expect(200)).body;
      expect(current.program).toMatchObject({ name: 'Northlight Rewards', enabled: true });
      expect(current.stats.accounts).toBeGreaterThan(0);

      const generous = await api(app, admin).put(`${A}/loyalty`, { name: 'Too generous', enabled: true, earnPointsPerPound: 200, redeemPointsPerPound: 100 });
      expect(generous.status).toBe(422);
      await api(app, editor).put(`${A}/loyalty`, { ...current.program }).expect(403);

      await api(app, admin).put(`${A}/loyalty`, { ...current.program, enabled: false }).expect(200);
      expect((await api(app, await guest(app)).get(`${T}/loyalty`)).body.program).toBeNull();
      await api(app, admin).put(`${A}/loyalty`, { ...current.program, enabled: true }).expect(200);
    });

    it('manages plans; plans that were sold can only be turned off', async () => {
      const plans = (await api(app, admin).get(`${A}/membership-plans`).expect(200)).body;
      const plus = plans.find((p: any) => p.name === 'Northlight Plus');
      expect(plus.activeMembers).toBeGreaterThan(0);
      expect((await api(app, admin).del(`${A}/membership-plans/${plus.id}`)).status).toBe(422);

      const created = (await api(app, admin).post(`${A}/membership-plans`, {
        name: 'Student', description: 'For students', priceMinor: 499, interval: 'month',
        entitlements: { ticketDiscountPercent: 20, foodDiscountPercent: 0, bookingFeeWaived: false, pointsMultiplier: 1 },
      }, null).expect(201)).body;
      expect((await api(app, admin).post(`${A}/membership-plans`, { name: 'Bad', priceMinor: 499, interval: 'month', entitlements: { pointsMultiplier: 1.3 } }, null)).status).toBe(422);
      await api(app, admin).put(`${A}/membership-plans/${created.id}`, { active: false }).expect(200);
      expect((await api(app).get(`${T}/membership/plans`)).body.map((p: any) => p.name)).not.toContain('Student');
      await api(app, editor).del(`${A}/membership-plans/${created.id}`).expect(403);
      await api(app, admin).del(`${A}/membership-plans/${created.id}`).expect(204);
    });
  });
});
