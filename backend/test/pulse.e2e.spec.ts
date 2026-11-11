import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { api, createApp, guest, T } from './harness';
import { leadCurveFrom, refreshBankHolidays, rollupOutcomes, rng } from '../src/intelligence/outcomes';
import { InterestFetcher, refreshInterest } from '../src/intelligence/interest';

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

  it('shows demo audience interest, labelled, and drives the forecast with it', async () => {
    const m = (await api(app, admin).get(`${A}/model`).expect(200)).body;
    expect(m.interest.length).toBeGreaterThan(0);
    expect(m.interest.every((i: any) => i.source === 'demo' && i.views > 0 && i.strength >= 0.6 && i.strength <= 1.8)).toBe(true);
    const f = (await api(app, admin).get(`${A}/forecasts?venueId=${venueId}`).expect(200)).body;
    const drivers = f.forecasts.flatMap((x: any) => x.drivers.map((d: any) => d.label));
    expect(drivers.some((l: string) => l.endsWith('audience interest'))).toBe(true);
    expect(JSON.stringify(f)).not.toMatch(/hype/i);
  });

  it('refreshes audience interest from Wikidata and Wikipedia page views, leaving unmatched films neutral', async () => {
    const tenant = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'kestrel' } }))!;
    const now = new Date();
    const film = await prisma.film.create({
      data: { tenantId: tenant.id, slug: `pulse-interest-${Date.now()}`, title: 'Interest Test Film', synopsis: 'x', releaseDate: new Date(now.getTime() + 20 * 86400_000), runtimeMinutes: 100, certificate: '12A', genres: ['Drama'] },
    });
    const other = await prisma.film.create({
      data: { tenantId: tenant.id, slug: `pulse-nomatch-${Date.now()}`, title: 'No Article Film', synopsis: 'x', releaseDate: new Date(now.getTime() + 25 * 86400_000), runtimeMinutes: 90, certificate: 'PG', genres: ['Comedy'] },
    });
    const queries: string[] = [];
    const urls: string[] = [];
    const fetcher: InterestFetcher = {
      async wikidata(q) {
        queries.push(q);
        return q.includes('"Interest Test Film"@en')
          ? { results: { bindings: [{ film: { value: 'http://www.wikidata.org/entity/Q1' }, article: { value: 'https://en.wikipedia.org/wiki/Interest_Test_Film' }, series: { value: 'true' } }] } }
          : { results: { bindings: [] } };
      },
      async pageviews(url) {
        urls.push(url);
        return { items: [{ views: 1200 }, { views: 800 }] };
      },
    };
    try {
      const r = await refreshInterest(prisma, tenant.id, now, fetcher);
      expect(r.updated).toBeGreaterThanOrEqual(1);
      expect(r.unmatched).toBeGreaterThanOrEqual(1);
      const row = await prisma.filmInterest.findUniqueOrThrow({ where: { filmId: film.id } });
      expect(row).toMatchObject({ source: 'wikipedia', article: 'Interest Test Film', series: true, views: 2000 });
      expect(urls.some((u) => u.includes('/Interest_Test_Film/daily/'))).toBe(true);
      expect(await prisma.filmInterest.findUnique({ where: { filmId: other.id } })).toBeNull();
      // Once matched, later refreshes reuse the article and skip Wikidata.
      const before = queries.length;
      await refreshInterest(prisma, tenant.id, now, fetcher);
      expect(queries.filter((q) => q.includes('"Interest Test Film"@en')).length).toBe(queries.slice(0, before).filter((q) => q.includes('"Interest Test Film"@en')).length);
    } finally {
      await prisma.film.deleteMany({ where: { id: { in: [film.id, other.id] } } });
    }
  });

  it('reports its own accuracy from a rolling backtest, against baselines, labelled with its basis', async () => {
    const a = (await api(app, admin).get(`${A}/accuracy`).expect(200)).body;
    expect(a.basis.note).toContain('demo');
    expect(a.folds).toBeGreaterThan(0);
    expect(a.pulse.map((p: any) => p.hoursBefore)).toEqual([168, 24, 3]);
    const weekOut = a.pulse[0].score;
    expect(weekOut.shows).toBeGreaterThan(100);
    expect(weekOut.wape).toBeLessThan(a.baselines.ukPrior.wape);
    expect(weekOut.coverage80).toBeGreaterThan(0.5);
    expect(a.weekly.length).toBe(a.folds);
    await api(app, kestrel).get(`${A}/accuracy`).expect(403);
  });

  it('simulates a change to one cinema-day without changing anything', async () => {
    const day = new Date(Date.now() + 86400_000).toISOString().slice(0, 10);
    const f = (await api(app, admin).get(`${A}/forecasts?venueId=${venueId}&from=${day}T00:00:00Z&to=${day}T23:59:00Z`).expect(200)).body.forecasts;
    expect(f.length).toBeGreaterThan(1);
    const before = await prisma.screening.count({ where: { venueId } });
    const add = (await api(app, admin).post(`${A}/simulate`).send({ venueId, date: f[0].localDate, change: { kind: 'add', filmId: f[0].film.id, auditoriumId: f[0].screen.id, time: '23:30' } }).expect(200)).body;
    expect(add.action).toContain('Add');
    expect(add.change.admissions).toBeGreaterThanOrEqual(0);
    expect(add.assumptions.length).toBeGreaterThanOrEqual(3);
    expect(add.basis.note).toContain('demo');
    const cancel = (await api(app, admin).post(`${A}/simulate`).send({ venueId, date: f[0].localDate, change: { kind: 'remove', screeningId: f[0].screeningId } }).expect(200)).body;
    expect(cancel.change.admissions).toBeLessThanOrEqual(0);
    const price = (await api(app, admin).post(`${A}/simulate`).send({ venueId, date: f[0].localDate, change: { kind: 'price', screeningId: f[0].screeningId, percent: -20 } }).expect(200)).body;
    expect(price.assumptions.some((a: string) => a.includes('price'))).toBe(true);
    expect(await prisma.screening.count({ where: { venueId } })).toBe(before);
    await api(app, admin).post(`${A}/simulate`).send({ venueId, change: { kind: 'price', screeningId: f[0].screeningId, percent: 0 } }).expect(422);
    await api(app, admin).post(`${A}/simulate`).send({ venueId, change: { kind: 'add', filmId: f[0].film.id, auditoriumId: f[0].screen.id, time: '25:00' } }).expect(422);
    await api(app, kestrel).post(`${A}/simulate`).send({ venueId, change: { kind: 'remove', screeningId: f[0].screeningId } }).expect(403);
  });
});
