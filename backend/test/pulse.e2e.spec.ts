import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { api, createApp, guest, T } from './harness';
import { leadCurveFrom, refreshBankHolidays, rollupOutcomes, rng } from '../src/intelligence/outcomes';

describe('Pulse (integration)', () => {
  let app: INestApplication;
  let admin: string;
  let kestrel: string;
  let venueId: string;
  const A = '/v1/admin/t/northlight/pulse';
  const prisma = new PrismaClient();
  const login = async (email: string) => (await request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email, password: 'operator-dev-password' }).expect(200)).body.token;

  beforeAll(async () => {
    app = await createApp();
    admin = await login('admin@northlight.example');
    kestrel = await login('admin@kestrel.example');
    venueId = ((await api(app, admin).get('/v1/admin/t/northlight/venues').expect(200)).body as any[])[0].id;
  });
  afterAll(async () => {
    await prisma.$disconnect();
    await app.close();
  });

  it('learns from labelled demo history and says so', async () => {
    const m = (await api(app, admin).get(`${A}/model`).expect(200)).body;
    expect(m.basis.demoShows).toBeGreaterThan(1000);
    expect(m.basis.note).toContain('demo');
    expect(m.multipliers.venue.length).toBeGreaterThan(0);
    expect(m.curves.hoursBefore).toEqual([168, 72, 48, 24, 12, 6, 3, 1, 0]);
    expect(Object.values(m.priors.slotBase).every((v: any) => v > 0 && v < 1)).toBe(true);
  });

  it('forecasts upcoming screenings with a range, pace and plain-English drivers', async () => {
    const f = (await api(app, admin).get(`${A}/forecasts?venueId=${venueId}`).expect(200)).body;
    expect(f.basis.note).toContain('demo');
    expect(f.forecasts.length).toBeGreaterThan(0);
    const x = f.forecasts[0];
    expect(x.expected).toBeGreaterThanOrEqual(x.soldNow);
    expect(x.expected).toBeLessThanOrEqual(x.capacity);
    expect(x.low).toBeLessThanOrEqual(x.expected);
    expect(x.high).toBeGreaterThanOrEqual(x.expected);
    expect(['low', 'medium', 'high']).toContain(x.confidence);
    expect(x.drivers.length).toBeGreaterThan(0);
    expect(typeof x.drivers[0].explanation).toBe('string');
    expect(f.daily.length).toBeGreaterThan(0);
  });

  it('serves pricing, screens, staffing, food, baskets, loyalty and anomalies, each with its basis', async () => {
    for (const p of ['pricing', 'screens', 'baskets', 'loyalty', 'anomalies', `staffing?venueId=${venueId}`, `food?venueId=${venueId}`]) {
      const r = (await api(app, admin).get(`${A}/${p}`).expect(200)).body;
      expect(r.basis).toBeDefined();
    }
    const loyalty = (await api(app, admin).get(`${A}/loyalty`).expect(200)).body;
    expect(loyalty.basis.demoCustomers).toBeGreaterThan(0);
    expect(JSON.stringify(loyalty)).not.toContain('@');
    const baskets = (await api(app, admin).get(`${A}/baskets`).expect(200)).body;
    expect(baskets.rules.length).toBeGreaterThan(0);
    const staffing = (await api(app, admin).get(`${A}/staffing?venueId=${venueId}`).expect(200)).body;
    expect(Array.isArray(staffing.windows)).toBe(true);
    expect(typeof staffing.summary).toBe('string');
    await api(app, admin).get(`${A}/staffing`).expect(422);
  });

  it('keeps every operator to its own data', async () => {
    await api(app, kestrel).get(`${A}/model`).expect(403);
    await api(app, kestrel).get(`/v1/admin/t/kestrel/pulse/staffing?venueId=${venueId}`).expect(404);
    await request(app.getHttpServer()).get(`${A}/model`).expect(401);
  });

  it('recommends films to customers and lists films often booked together', async () => {
    const token = await guest(app);
    const recs = (await api(app, token).get(`${T}/me/recommendations`).expect(200)).body;
    expect(Array.isArray(recs.recommendations)).toBe(true);
    if (recs.recommendations.length) expect(recs.recommendations[0].reason).toBeTruthy();
    await request(app.getHttpServer()).get(`${T}/me/recommendations`).expect(401);
    const films = (await api(app).get(`${T}/films`).expect(200)).body as any[];
    const also = (await api(app).get(`${T}/films/${films[0].id}/also-booked`).expect(200)).body;
    expect(Array.isArray(also.films)).toBe(true);
    await api(app).get(`${T}/films/nope/also-booked`).expect(404);
  });

  it('rolls up finished screenings as live outcomes', async () => {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { slug: 'northlight' } });
    const later = new Date(Date.now() + 9 * 86400_000);
    const n = await rollupOutcomes(prisma as any, tenant.id, later);
    expect(n).toBeGreaterThan(0);
    const live = await prisma.showOutcome.findMany({ where: { tenantId: tenant.id, source: 'live' }, take: 5 });
    expect(live.every((o) => o.screeningId && o.capacity >= o.admissions)).toBe(true);
    // Running it again replaces rather than duplicates.
    await rollupOutcomes(prisma as any, tenant.id, later);
    expect(await prisma.showOutcome.count({ where: { tenantId: tenant.id, source: 'live' } })).toBe(n);
    await prisma.showOutcome.deleteMany({ where: { tenantId: tenant.id, source: 'live' } });
  });

  it('builds booking curves from timestamps and refreshes bank holidays from the gov.uk feed', async () => {
    const start = new Date('2026-11-14T19:00:00Z');
    const curve = leadCurveFrom(start, [
      { at: new Date(start.getTime() - 100 * 3_600_000), seats: 4 },
      { at: new Date(start.getTime() - 2 * 3_600_000), seats: 4 },
    ])!;
    expect(curve[0]).toBe(0);
    expect(curve[1]).toBe(0.5);
    expect(curve[curve.length - 1]).toBe(1);
    expect(leadCurveFrom(start, [{ at: start, seats: 2 }])).toBeNull();
    const a = rng(1);
    const b = rng(1);
    expect([a(), a()]).toEqual([b(), b()]);
    const n = await refreshBankHolidays(prisma as any, async () => ({ 'england-and-wales': { events: [{ date: '2026-12-25', title: 'Christmas Day' }] }, scotland: { events: [] } }));
    expect(n).toBe(1);
    expect(await prisma.bankHoliday.count()).toBe(1);
    await prisma.bankHoliday.deleteMany();
  });
});
