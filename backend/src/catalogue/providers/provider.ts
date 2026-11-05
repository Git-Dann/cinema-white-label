/**
 * Provider-independent film catalogue interface.
 *
 * A provider supplies metadata and artwork references. It never supplies
 * booking inventory: screenings, seats and prices come from separate
 * integration boundaries (see docs/integrations.md).
 */

export type ProviderId = 'operator' | 'licensed' | 'enrichment' | 'fixture' | (string & {});

export interface ProviderFilmFields {
  title: string;
  tagline: string | null;
  synopsis: string;
  releaseDate: string; // YYYY-MM-DD, UK release
  runtimeMinutes: number;
  certificate: string;
  genres: string[];
  director: string | null;
  cast: string[];
  originalLanguage: string;
}

export interface ProviderAsset {
  kind: 'POSTER' | 'BACKDROP' | 'HERO' | 'THUMBNAIL' | 'BANNER' | 'TRAILER_THUMBNAIL';
  sourceRef: string;
  width: number;
  height: number;
  mimeType: string;
  language: string | null;
  territory: string | null;
  licenceRef: string | null;
  attribution: string | null;
  usageRestrictions: string | null;
  expiresAt: string | null;
}

export interface ProviderFilmRecord {
  provider: ProviderId;
  externalId: string;
  /** Other identifiers the provider knows (e.g. { imdb: 'tt...', eidr: '10.5240/...' }). */
  crossReferences: Record<string, string>;
  fields: Partial<ProviderFilmFields>;
  assets: ProviderAsset[];
}

export interface FilmCatalogueProvider {
  readonly id: ProviderId;
  /** True only when credentials AND the commercial licence for this deployment are configured. */
  isEnabled(): boolean;
  fetchFilms(opts: { territory: string; since?: Date }): Promise<ProviderFilmRecord[]>;
}
