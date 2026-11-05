import { FILMS } from '../../fixtures/films';
import { FilmCatalogueProvider, ProviderFilmRecord } from './provider';

/** Development fixtures: original fictional films with locally generated artwork. */
export class FixtureFilmProvider implements FilmCatalogueProvider {
  readonly id = 'fixture';
  constructor(private readonly seedDate: Date = new Date()) {}
  isEnabled() {
    return true;
  }
  async fetchFilms(): Promise<ProviderFilmRecord[]> {
    return FILMS.map((f) => {
      const d = new Date(this.seedDate.getTime() + f.releaseOffsetDays * 86400_000);
      return {
        provider: this.id,
        externalId: f.slug,
        crossReferences: {},
        fields: {
          title: f.title, tagline: f.tagline, synopsis: f.synopsis, releaseDate: d.toISOString().slice(0, 10),
          runtimeMinutes: f.runtimeMinutes, certificate: f.certificate, genres: f.genres, director: f.director, cast: f.cast, originalLanguage: 'en',
        },
        assets: (['POSTER', 'BACKDROP'] as const).map((kind) => ({
          kind,
          sourceRef: `fixture://${f.slug}-${kind === 'POSTER' ? 'poster' : 'backdrop'}.jpg`,
          width: kind === 'POSTER' ? 800 : 1600,
          height: kind === 'POSTER' ? 1200 : 900,
          mimeType: 'image/jpeg', language: null, territory: null,
          licenceRef: 'internal-development-fixture', attribution: null, usageRestrictions: 'Development only', expiresAt: null,
        })),
      };
    });
  }
}

/**
 * Operator- or distributor-supplied JSON feed. The feed format is documented in
 * docs/film-data-providers.md; validation happens before resolution.
 */
export class OperatorFeedProvider implements FilmCatalogueProvider {
  readonly id = 'operator';
  constructor(private readonly loadFeed: () => Promise<unknown[]>) {}
  isEnabled() {
    return true;
  }
  async fetchFilms(): Promise<ProviderFilmRecord[]> {
    const items = await this.loadFeed();
    return items.map((raw) => {
      const r = raw as Record<string, any>;
      if (!r.id || !r.title) throw new Error('Operator feed item missing id or title');
      return {
        provider: this.id,
        externalId: String(r.id),
        crossReferences: (r.imdbId ? { imdb: String(r.imdbId) } : {}) as Record<string, string>,
        fields: {
          title: r.title, tagline: r.tagline ?? null, synopsis: r.synopsis, releaseDate: r.ukReleaseDate,
          runtimeMinutes: r.runtimeMinutes, certificate: r.bbfcCertificate, genres: r.genres ?? [], director: r.director ?? null, cast: r.cast ?? [], originalLanguage: r.language ?? 'en',
        },
        assets: (r.assets ?? []).map((a: Record<string, any>) => ({
          kind: a.kind, sourceRef: a.url, width: a.width, height: a.height, mimeType: a.mimeType ?? 'image/jpeg',
          language: a.language ?? null, territory: a.territory ?? 'GB', licenceRef: a.licenceRef ?? null, attribution: a.credit ?? null,
          usageRestrictions: a.restrictions ?? null, expiresAt: a.expiresAt ?? null,
        })),
      };
    });
  }
}

/**
 * TMDB enrichment adapter. Disabled unless BOTH an API key and an explicit
 * commercial-licence flag are configured: TMDB's free API terms do not cover
 * a commercial cinema product, and artwork rights must be cleared separately.
 * Only the mapping is implemented here; network fetching is Phase 2.
 */
export class TmdbEnrichmentProvider implements FilmCatalogueProvider {
  readonly id = 'enrichment';
  isEnabled() {
    return !!process.env.TMDB_API_KEY && process.env.TMDB_COMMERCIAL_LICENCE === 'confirmed';
  }
  async fetchFilms(): Promise<ProviderFilmRecord[]> {
    if (!this.isEnabled()) return [];
    throw new Error('TMDB fetching is not implemented yet (Phase 2). See docs/film-data-providers.md');
  }

  /** Maps a TMDB /movie/{id}?append_to_response=release_dates,credits payload. */
  static map(m: Record<string, any>): ProviderFilmRecord {
    const gb = (m.release_dates?.results ?? []).find((r: any) => r.iso_3166_1 === 'GB');
    const theatrical = gb?.release_dates?.find((d: any) => d.type === 3) ?? gb?.release_dates?.[0];
    return {
      provider: 'enrichment',
      externalId: `tmdb:${m.id}`,
      crossReferences: m.imdb_id ? { imdb: m.imdb_id } : {},
      fields: {
        title: m.title,
        tagline: m.tagline || null,
        synopsis: m.overview,
        releaseDate: (theatrical?.release_date ?? m.release_date ?? '').slice(0, 10) || undefined,
        runtimeMinutes: m.runtime || undefined,
        certificate: theatrical?.certification || undefined,
        genres: (m.genres ?? []).map((g: any) => g.name),
        director: (m.credits?.crew ?? []).find((c: any) => c.job === 'Director')?.name ?? null,
        cast: (m.credits?.cast ?? []).slice(0, 6).map((c: any) => c.name),
        originalLanguage: m.original_language,
      },
      // Artwork is deliberately not imported from enrichment providers until rights are cleared.
      assets: [],
    };
  }
}
