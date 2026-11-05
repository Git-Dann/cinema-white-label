import { TmdbEnrichmentProvider } from './adapters';
import { ProviderFilmRecord } from './provider';
import { normaliseTitle, resolveFilms } from './resolver';

const rec = (provider: string, externalId: string, fields: ProviderFilmRecord['fields'], crossReferences: Record<string, string> = {}): ProviderFilmRecord => ({
  provider, externalId, crossReferences, fields, assets: [],
});

const PRECEDENCE = ['operator', 'licensed', 'enrichment', 'fixture'];

describe('film provider resolution', () => {
  it('normalises titles for matching', () => {
    expect(normaliseTitle('The Lantern Keeper')).toBe('lantern keeper');
    expect(normaliseTitle('Copper & Clay')).toBe('copper and clay');
    expect(normaliseTitle('Amélie')).toBe('amelie');
  });

  it('merges providers into one film with field-level provenance', () => {
    const { resolved, review } = resolveFilms(
      [
        rec('enrichment', 'tmdb:1', { title: 'Northbound', synopsis: 'Enrichment synopsis', releaseDate: '2026-10-30', runtimeMinutes: 131, cast: ['A', 'B'] }, { imdb: 'tt001' }),
        rec('operator', 'op-77', { title: 'Northbound', synopsis: 'Operator synopsis', releaseDate: '2026-11-01', certificate: '15' }, { imdb: 'tt001' }),
      ],
      [],
      PRECEDENCE,
    );
    expect(review).toEqual([]);
    expect(resolved).toHaveLength(1);
    const f = resolved[0];
    expect(f.filmId).toBeNull();
    expect(f.fields.synopsis).toBe('Operator synopsis'); // operator wins
    expect(f.provenance.synopsis).toBe('operator');
    expect(f.fields.cast).toEqual(['A', 'B']); // filled by enrichment
    expect(f.provenance.cast).toBe('enrichment');
    expect(f.externalIds.map((e) => e.provider).sort()).toEqual(['enrichment', 'operator']);
  });

  it('links to an existing film by external id instead of duplicating', () => {
    const { resolved } = resolveFilms(
      [rec('operator', 'op-1', { title: 'Renamed Title' })],
      [{ id: 'film_1', title: 'Original', releaseYear: 2026, externalIds: [{ provider: 'operator', externalId: 'op-1' }] }],
      PRECEDENCE,
    );
    expect(resolved[0].filmId).toBe('film_1');
  });

  it('matches on title and year when unique', () => {
    const { resolved } = resolveFilms(
      [rec('licensed', 'lic-9', { title: 'the quiet orchard', releaseDate: '2026-10-20' })],
      [{ id: 'film_q', title: 'The Quiet Orchard', releaseYear: 2026, externalIds: [] }],
      PRECEDENCE,
    );
    expect(resolved[0].filmId).toBe('film_q');
  });

  it('sends ambiguous title matches to manual review and never creates a film', () => {
    const existing = [
      { id: 'a', title: 'Tidewater', releaseYear: 2026, externalIds: [] },
      { id: 'b', title: 'Tidewater', releaseYear: 2025, externalIds: [] },
    ];
    const { resolved, review } = resolveFilms([rec('licensed', 'x', { title: 'Tidewater', releaseDate: '2026-01-02' })], existing, PRECEDENCE);
    expect(resolved).toHaveLength(0);
    expect(review[0]).toMatchObject({ reason: 'ambiguous_title_match', candidates: ['a', 'b'] });
  });

  it('maps a TMDB payload and keeps artwork out until rights are cleared', () => {
    const r = TmdbEnrichmentProvider.map({
      id: 42, imdb_id: 'tt42', title: 'Fictional', tagline: '', overview: 'Story', runtime: 101, original_language: 'en',
      genres: [{ name: 'Drama' }], release_date: '2026-05-01',
      release_dates: { results: [{ iso_3166_1: 'GB', release_dates: [{ type: 3, release_date: '2026-05-08T00:00:00.000Z', certification: '12A' }] }] },
      credits: { crew: [{ job: 'Director', name: 'D. Person' }], cast: [{ name: 'One' }, { name: 'Two' }] },
    });
    expect(r.fields).toMatchObject({ title: 'Fictional', tagline: null, releaseDate: '2026-05-08', certificate: '12A', director: 'D. Person', cast: ['One', 'Two'] });
    expect(r.crossReferences).toEqual({ imdb: 'tt42' });
    expect(r.assets).toEqual([]);
  });

  it('keeps the TMDB adapter disabled without an explicit commercial licence', () => {
    process.env.TMDB_API_KEY = 'k';
    delete process.env.TMDB_COMMERCIAL_LICENCE;
    expect(new TmdbEnrichmentProvider().isEnabled()).toBe(false);
    delete process.env.TMDB_API_KEY;
  });
});
