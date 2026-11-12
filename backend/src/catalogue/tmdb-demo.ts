import { Prisma, PrismaClient } from '@prisma/client';
import sharp from 'sharp';
import { TmdbEnrichmentProvider } from './providers/adapters';
import { BIO_LIMIT, buildFilmDetails, PersonInfo, personInfo, readDetails } from './film-details';

/*
 * Demo catalogue from TMDB (The Movie Database).
 *
 * TMDB's free API is licensed for non-commercial use. This importer exists so a
 * private demo can show real films; it is off unless DEMO_CATALOGUE=tmdb and a
 * TMDB key are set, every image is attributed to TMDB, and the apps show TMDB's
 * required notice. A paying operator's catalogue comes from their own feed or a
 * licensed provider instead (docs/film-data-providers.md, docs/decisions/0004).
 */

export const TMDB_NOTICE = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';
const API = 'https://api.themoviedb.org/3';
export const TMDB_IMAGES = 'https://image.tmdb.org/t/p';

/** Sizes fetched for storage keys; our media endpoint makes smaller renditions. */
const POSTER_SIZE = { key: 'w780', width: 780, height: 1170 };
const BACKDROP_SIZE = { key: 'w1280', width: 1280, height: 720 };
const LOGO_WIDTH = 500;

export function tmdbDemoEnabled(env = process.env) {
  return env.DEMO_CATALOGUE === 'tmdb' && !!env.TMDB_API_KEY;
}

export interface TmdbClient {
  get(path: string, query?: Record<string, string>): Promise<any>;
  /** Small image used only to work out the placeholder colour. */
  thumbnail(path: string): Promise<Buffer>;
}

/** Accepts either a v4 read access token (long JWT) or a v3 API key. */
export function httpTmdbClient(key = process.env.TMDB_API_KEY ?? ''): TmdbClient {
  const bearer = key.length > 40;
  return {
    async get(path, query = {}) {
      const url = new URL(`${API}${path}`);
      for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
      if (!bearer) url.searchParams.set('api_key', key);
      const res = await fetch(url, { headers: bearer ? { Authorization: `Bearer ${key}`, accept: 'application/json' } : { accept: 'application/json' } });
      if (!res.ok) throw new Error(`TMDB ${path} returned ${res.status}`);
      return res.json();
    },
    async thumbnail(path) {
      const res = await fetch(`${TMDB_IMAGES}/w92${path}`);
      if (!res.ok) throw new Error(`TMDB image ${path} returned ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

const slugify = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);

async function placeholderColour(client: TmdbClient, path: string): Promise<string | null> {
  try {
    const { dominant } = await sharp(await client.thumbnail(path)).stats();
    return `#${[dominant.r, dominant.g, dominant.b].map((v) => v.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
  } catch {
    return null;
  }
}

type Db = Pick<PrismaClient, 'film' | 'filmExternalId' | 'mediaAsset' | '$transaction'>;

/**
 * Loads UK now-showing and upcoming films from TMDB into a tenant, hides the
 * fictional films, and keeps imported films up to date on later runs.
 * Returns what changed. Screenings are programmed separately (ensureScreeningHorizon).
 */
export async function importTmdbDemoCatalogue(db: Db, tenantId: string, client: TmdbClient, now: Date, opts = { nowShowing: 10, comingSoon: 6 }) {
  const today = now.toISOString().slice(0, 10);
  const [playing, upcoming] = await Promise.all([
    client.get('/movie/now_playing', { region: 'GB', language: 'en-GB', page: '1' }),
    client.get('/movie/upcoming', { region: 'GB', language: 'en-GB', page: '1' }),
  ]);
  const usable = (m: any) => !m.adult && m.poster_path && m.backdrop_path && m.overview;
  const picks = [
    ...(playing.results ?? []).filter((m: any) => usable(m) && m.release_date <= today).slice(0, opts.nowShowing),
    ...(upcoming.results ?? []).filter((m: any) => usable(m) && m.release_date > today).slice(0, opts.comingSoon),
  ];

  let created = 0;
  let updated = 0;
  const kept: string[] = [];
  // Fetch every film's details at once; one at a time was most of the import's time.
  const details = await Promise.all(
    picks.map((p) => client.get(`/movie/${p.id}`, { language: 'en-GB', append_to_response: 'release_dates,credits,keywords,images', include_image_language: 'en,null' })),
  );

  // Leading cast's biography, birthday and birthplace. Each person is fetched once and
  // reused on later runs and by every operator, so the daily refresh stays quick.
  const people = new Map<number, PersonInfo>();
  for (const f of await db.film.findMany({ where: { externalIds: { some: { provider: 'tmdb' } } }, select: { details: true } })) {
    for (const c of readDetails(f.details).cast) {
      if (c.birthday !== undefined) people.set(c.id, { biography: c.biography, fullBiography: c.fullBiography ?? null, birthday: c.birthday, deathday: c.deathday ?? null, placeOfBirth: c.placeOfBirth ?? null });
    }
  }
  const wanted = [...new Set(details.flatMap((m) => (m.credits?.cast ?? []).slice(0, BIO_LIMIT).map((c: any) => c.id as number)))].filter((id) => !people.has(id));
  await inBatches(wanted, 20, async (id) => {
    try {
      people.set(id, personInfo(await client.get(`/person/${id}`, { language: 'en-US' })));
    } catch {
      /* left out; tried again on the next run */
    }
  });

  for (const [pi, summary] of picks.entries()) {
    const m = details[pi];
    const f = TmdbEnrichmentProvider.map(m).fields;
    const releaseDate = f.releaseDate || summary.release_date;
    if (!f.title || !releaseDate) continue;
    const data = {
      title: f.title,
      tagline: f.tagline ?? null,
      synopsis: f.synopsis || summary.overview,
      releaseDate: new Date(`${releaseDate}T00:00:00Z`),
      runtimeMinutes: f.runtimeMinutes ?? 120,
      certificate: f.certificate || 'TBC',
      genres: f.genres ?? [],
      director: f.director ?? null,
      cast: (f.cast ?? []).slice(0, 5),
      originalLanguage: f.originalLanguage ?? 'en',
      hidden: false,
      details: undefined as unknown as Prisma.InputJsonValue,
      // Popularity and votes feed Pulse's film-strength prior (docs/pulse.md).
      provenance: { source: 'tmdb-demo', tmdbId: m.id, importedAt: now.toISOString(), popularity: m.popularity ?? summary.popularity ?? null, voteCount: m.vote_count ?? null, voteAverage: m.vote_average ?? null } as Prisma.InputJsonValue,
    };
    const link = await db.filmExternalId.findUnique({
      where: { tenantId_provider_externalId: { tenantId, provider: 'tmdb', externalId: String(m.id) } },
      include: { film: { select: { details: true } } },
    });
    // Advice an operator typed in (Parents Guide) survives the refresh.
    const built = buildFilmDetails(m, people);
    const previous = link ? readDetails(link.film.details) : null;
    data.details = (previous?.adviceSource === 'operator' ? { ...built, advice: previous.advice, adviceSource: 'operator' } : built) as unknown as Prisma.InputJsonValue;
    let filmId: string;
    if (link) {
      await db.film.update({ where: { id: link.filmId }, data });
      filmId = link.filmId;
      updated++;
    } else {
      const film = await db.film.create({
        data: { ...data, tenantId, slug: `${slugify(f.title)}-${m.id}`, externalIds: { create: [{ tenantId, provider: 'tmdb', externalId: String(m.id) }] } },
      });
      filmId = film.id;
      created++;
    }
    kept.push(filmId);

    // Artwork: one poster and one backdrop, replaced if TMDB's choice changed.
    for (const [kind, path, size, focalY] of [
      ['POSTER', m.poster_path ?? summary.poster_path, POSTER_SIZE, 0.5],
      ['BACKDROP', m.backdrop_path ?? summary.backdrop_path, BACKDROP_SIZE, 0.4],
    ] as const) {
      if (!path) continue;
      const storageKey = `tmdb/${size.key}${path}`;
      const current = await db.mediaAsset.findFirst({ where: { filmId, kind, provider: 'tmdb' } });
      if (current?.storageKey === storageKey) continue;
      const colour = await placeholderColour(client, path);
      await db.$transaction([
        db.mediaAsset.deleteMany({ where: { filmId, kind } }),
        db.mediaAsset.create({
          data: {
            tenantId, filmId, kind, provider: 'tmdb', sourceRef: `${TMDB_IMAGES}/original${path}`, storageKey, licenceRef: 'TMDB API terms (non-commercial demo)',
            attribution: 'Image: TMDB', usageRestrictions: 'Demo only. Not cleared for commercial use.', width: size.width, height: size.height, mimeType: 'image/jpeg',
            dominantColor: colour, focalX: 0.5, focalY, isPreferred: true, approvedContexts: kind === 'POSTER' ? ['list', 'detail', 'wallet'] : ['detail', 'hero'],
          },
        }),
      ]);
    }

    // Title logo (transparent PNG), English first, then language-neutral; the best-voted wins.
    const logo = pickLogo(m.images?.logos ?? []);
    const current = await db.mediaAsset.findFirst({ where: { filmId, kind: 'LOGO', provider: 'tmdb' } });
    const logoKey = logo ? `tmdb/w${LOGO_WIDTH}${logo.file_path}` : null;
    if (current?.storageKey !== logoKey) {
      await db.$transaction([
        db.mediaAsset.deleteMany({ where: { filmId, kind: 'LOGO' } }),
        ...(logo && logoKey
          ? [
              db.mediaAsset.create({
                data: {
                  tenantId, filmId, kind: 'LOGO', provider: 'tmdb', sourceRef: `${TMDB_IMAGES}/original${logo.file_path}`, storageKey: logoKey,
                  licenceRef: 'TMDB API terms (non-commercial demo)', attribution: 'Image: TMDB', usageRestrictions: 'Demo only. Not cleared for commercial use.',
                  width: LOGO_WIDTH, height: Math.max(1, Math.round(LOGO_WIDTH / (logo.aspect_ratio || 3))), mimeType: 'image/png',
                  dominantColor: null, focalX: 0.5, focalY: 0.5, isPreferred: true, approvedContexts: ['detail', 'hero'],
                },
              }),
            ]
          : []),
      ]);
    }
  }

  // Only real films are listed while the demo catalogue is on. Films stay in the
  // database, so existing bookings and tickets keep working.
  const hidden = kept.length
    ? (await db.film.updateMany({ where: { tenantId, hidden: false, id: { notIn: kept } }, data: { hidden: true } })).count
    : 0;
  return { created, updated, hidden, films: kept.length };
}

/** English logos first, then ones with no language; within each, TMDB's highest rated. */
export function pickLogo(logos: { file_path: string; iso_639_1: string | null; vote_average?: number; aspect_ratio?: number }[]) {
  const usable = logos.filter((l) => l.file_path && (l.iso_639_1 === 'en' || l.iso_639_1 === null) && !l.file_path.endsWith('.svg'));
  return usable.sort((a, b) => Number(b.iso_639_1 === 'en') - Number(a.iso_639_1 === 'en') || (b.vote_average ?? 0) - (a.vote_average ?? 0))[0] ?? null;
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}
