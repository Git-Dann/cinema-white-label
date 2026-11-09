import { INestApplication } from '@nestjs/common';
import sharp from 'sharp';
import request from 'supertest';
import { Clock } from '../src/common/clock';
import { PrismaService } from '../src/common/prisma.service';
import { ensureScreeningHorizon, SHOW_TIMES } from '../src/catalogue/schedule';
import { importTmdbDemoCatalogue, TmdbClient, tmdbDemoEnabled } from '../src/catalogue/tmdb-demo';
import { RoutedMediaStorage } from '../src/media/storage';
import { api, createApp } from './harness';

/** A stand-in for TMDB with two films showing in the UK and one coming soon. */
function fakeTmdb(today: Date): TmdbClient & { calls: string[] } {
  const day = (offset: number) => new Date(today.getTime() + offset * 86400_000).toISOString().slice(0, 10);
  const movie = (id: number, title: string, release: string, cert: string) => ({
    id, title, overview: `${title} overview.`, release_date: release, poster_path: `/p${id}.jpg`, backdrop_path: `/b${id}.jpg`, adult: false,
  });
  const lists: Record<string, any> = {
    '/movie/now_playing': { results: [movie(101, 'Real Film One', day(-10), '12A'), movie(102, 'Real Film Two', day(-3), '15'), movie(109, 'Not Out Yet', day(20), '12A')] },
    '/movie/upcoming': { results: [movie(103, 'Coming Real Film', day(14), '')] },
  };
  const details = (id: number) => {
    const base = [...lists['/movie/now_playing'].results, ...lists['/movie/upcoming'].results].find((m: any) => m.id === id);
    return {
      ...base, tagline: 'A tagline.', runtime: 118, original_language: 'en', genres: [{ id: 1, name: 'Drama' }], imdb_id: `tt${id}`,
      release_dates: { results: [{ iso_3166_1: 'GB', release_dates: [{ type: 3, release_date: `${base.release_date}T00:00:00.000Z`, certification: id === 102 ? '15' : id === 103 ? '' : '12A' }] }] },
      credits: { crew: [{ job: 'Director', name: `Director ${id}` }], cast: [{ name: 'Actor A' }, { name: 'Actor B' }] },
    };
  };
  const calls: string[] = [];
  return {
    calls,
    async get(path) {
      calls.push(path);
      if (lists[path]) return lists[path];
      const id = Number(path.split('/').pop());
      return details(id);
    },
    thumbnail: () => sharp({ create: { width: 8, height: 12, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer(),
  };
}

describe('TMDB demo catalogue and rolling screenings (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let tenantId: string;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    tenantId = (await prisma.tenant.findUniqueOrThrow({ where: { slug: 'kestrel' } })).id;
  });
  afterEach(() => app.get(Clock).reset());
  afterAll(async () => {
    // Put Kestrel back as the seed left it, for the other suites.
    const imported = await prisma.filmExternalId.findMany({ where: { tenantId, provider: 'tmdb' }, select: { filmId: true } });
    await prisma.screening.deleteMany({ where: { filmId: { in: imported.map((f) => f.filmId) } } });
    await prisma.film.deleteMany({ where: { id: { in: imported.map((f) => f.filmId) } } });
    await prisma.film.updateMany({ where: { tenantId }, data: { hidden: false } });
    await app.close();
  });

  it('is off unless both the switch and a key are set', () => {
    expect(tmdbDemoEnabled({})).toBe(false);
    expect(tmdbDemoEnabled({ TMDB_API_KEY: 'k' })).toBe(false);
    expect(tmdbDemoEnabled({ DEMO_CATALOGUE: 'tmdb' })).toBe(false);
    expect(tmdbDemoEnabled({ DEMO_CATALOGUE: 'tmdb', TMDB_API_KEY: 'k' })).toBe(true);
  });

  it('imports real films with UK certificates and attributed artwork, hides the fictional ones, and updates in place', async () => {
    const now = app.get(Clock).now();
    const fictional = await prisma.film.findFirstOrThrow({ where: { tenantId, hidden: false } });
    const first = await importTmdbDemoCatalogue(prisma, tenantId, fakeTmdb(now), now);
    expect(first).toMatchObject({ created: 3, updated: 0, films: 3 });
    expect(first.hidden).toBeGreaterThan(0);

    const one = await prisma.film.findFirstOrThrow({ where: { tenantId, title: 'Real Film One' }, include: { assets: true } });
    expect(one).toMatchObject({ certificate: '12A', runtimeMinutes: 118, director: 'Director 101', cast: ['Actor A', 'Actor B'], hidden: false });
    expect(await prisma.film.findFirstOrThrow({ where: { tenantId, title: 'Coming Real Film' } })).toMatchObject({ certificate: 'TBC' });
    expect(one.assets.map((a) => [a.kind, a.storageKey, a.attribution]).sort()).toEqual([
      ['BACKDROP', 'tmdb/w1280/b101.jpg', 'Image: TMDB'],
      ['POSTER', 'tmdb/w780/p101.jpg', 'Image: TMDB'],
    ]);
    expect(one.assets[0].dominantColor).toMatch(/^#[0-9A-F]{6}$/);

    // The customer catalogue lists only the real films; a hidden film still opens (existing tickets).
    const listed = (await api(app).get('/v1/t/kestrel/films').expect(200)).body.map((f: any) => f.title).sort();
    expect(listed).toEqual(['Coming Real Film', 'Real Film One', 'Real Film Two']);
    await api(app).get(`/v1/t/kestrel/films/${fictional.id}`).expect(200);

    const second = await importTmdbDemoCatalogue(prisma, tenantId, fakeTmdb(now), now);
    expect(second).toMatchObject({ created: 0, updated: 3, hidden: 0 });
    expect(await prisma.mediaAsset.count({ where: { filmId: one.id } })).toBe(2);
  });

  it('moves future screenings onto showing films and keeps a week programmed', async () => {
    const now = app.get(Clock).now();
    const showing = await prisma.film.findMany({ where: { tenantId, hidden: false, releaseDate: { lte: now } }, select: { id: true } });
    expect(showing.length).toBe(2);

    const r = await ensureScreeningHorizon(prisma, tenantId, now);
    expect(r.reassigned + r.created).toBeGreaterThan(0);
    const future = await prisma.screening.findMany({ where: { tenantId, startsAt: { gt: now } }, include: { bookings: { select: { id: true } }, _count: { select: { seats: true } } } });
    // Nothing unbooked is left on a hidden film, and every new screening has a seat map.
    expect(future.filter((s) => !showing.some((f) => f.id === s.filmId) && s.bookings.length === 0)).toEqual([]);
    expect(future.every((s) => s._count.seats > 0)).toBe(true);

    // Seven days ahead are filled for every auditorium, and a second run adds nothing.
    const auditoriums = await prisma.auditorium.count({ where: { tenantId } });
    app.get(Clock).advance(3 * 86400_000);
    const later = app.get(Clock).now();
    const top = await ensureScreeningHorizon(prisma, tenantId, later);
    expect(top.created).toBeGreaterThan(0);
    const lastDay = new Date(later.getTime() + 6 * 86400_000);
    expect(await prisma.screening.count({ where: { tenantId, startsAt: { gt: new Date(lastDay.getTime() - 86400_000), lte: lastDay } } })).toBeGreaterThan(0);
    expect((await ensureScreeningHorizon(prisma, tenantId, later)).created).toBe(0);
    expect(SHOW_TIMES.length * auditoriums).toBeGreaterThan(0);
  });

  it('serves TMDB artwork through the media store, and the daily job is locked down', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#000' } }).png().toBuffer();
    const spy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response(png));
    const storage = new RoutedMediaStorage(prisma, { read: async () => Buffer.alloc(0), write: async () => undefined });
    expect((await storage.read('tmdb/w780/p101.jpg')).length).toBe(png.length);
    expect(spy).toHaveBeenCalledWith('https://image.tmdb.org/t/p/w780/p101.jpg');
    spy.mockRestore();

    const server = app.getHttpServer();
    delete process.env.CRON_SECRET;
    await request(server).get('/v1/cron/daily').expect(404);
    process.env.CRON_SECRET = 'test-cron';
    await request(server).get('/v1/cron/daily').set('Authorization', 'Bearer wrong').expect(401);
    const ok = (await request(server).get('/v1/cron/daily').set('Authorization', 'Bearer test-cron').expect(200)).body;
    expect(ok.kestrel.films).toBeNull();
    expect(ok.kestrel.screenings).toMatchObject({ created: expect.any(Number) });
    delete process.env.CRON_SECRET;
  });
});
