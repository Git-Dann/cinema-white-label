import { ProviderFilmFields, ProviderFilmRecord, ProviderId } from './provider';

/**
 * Resolves records from several providers into one internal film model with
 * field-level provenance. Pure and deterministic so it can be unit tested.
 *
 * Matching order:
 *   1. Exact external ID already linked to a film (any provider).
 *   2. Shared cross-reference ID (e.g. the same IMDb ID from two providers).
 *   3. Normalised title + release year (±1) when exactly one candidate exists.
 * Ambiguous matches go to manual review and NEVER create a new film.
 */

export interface ExistingFilm {
  id: string;
  title: string;
  releaseYear: number;
  externalIds: { provider: string; externalId: string }[];
}

export interface ResolvedFilm {
  /** Existing film id, or null when a new film should be created. */
  filmId: string | null;
  fields: Partial<ProviderFilmFields>;
  provenance: Partial<Record<keyof ProviderFilmFields, ProviderId>>;
  externalIds: { provider: string; externalId: string }[];
  records: ProviderFilmRecord[];
}

export interface ReviewItem {
  reason: 'ambiguous_title_match' | 'conflicting_ids';
  record: ProviderFilmRecord;
  candidates: string[];
}

export function normaliseTitle(t: string): string {
  return t
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/&/g, 'and')
    .replace(/^(the|a|an)\s+/, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const yearOf = (r: ProviderFilmRecord) => (r.fields.releaseDate ? Number(r.fields.releaseDate.slice(0, 4)) : null);

export function resolveFilms(records: ProviderFilmRecord[], existing: ExistingFilm[], precedence: ProviderId[]): { resolved: ResolvedFilm[]; review: ReviewItem[] } {
  const review: ReviewItem[] = [];
  const byExt = new Map<string, string>();
  for (const f of existing) for (const e of f.externalIds) byExt.set(`${e.provider}:${e.externalId}`, f.id);

  // Group records into clusters keyed by film id (existing) or a synthetic key (new).
  const clusters = new Map<string, ProviderFilmRecord[]>();
  const clusterFilm = new Map<string, string | null>();
  const crossRefKey = new Map<string, string>();

  const rank = (p: ProviderId) => {
    const i = precedence.indexOf(p);
    return i === -1 ? precedence.length : i;
  };
  const sorted = [...records].sort((a, b) => rank(a.provider) - rank(b.provider));

  for (const r of sorted) {
    let key: string | undefined;
    const direct = byExt.get(`${r.provider}:${r.externalId}`);
    if (direct) key = `film:${direct}`;

    if (!key) {
      for (const [ns, id] of Object.entries(r.crossReferences)) {
        const viaExisting = byExt.get(`${ns}:${id}`);
        const viaBatch = crossRefKey.get(`${ns}:${id}`);
        if (viaExisting) { key = `film:${viaExisting}`; break; }
        if (viaBatch) { key = viaBatch; break; }
      }
    }

    if (!key && r.fields.title) {
      const t = normaliseTitle(r.fields.title);
      const y = yearOf(r);
      const candidates = existing.filter((f) => normaliseTitle(f.title) === t && (y === null || Math.abs(f.releaseYear - y) <= 1));
      if (candidates.length === 1) key = `film:${candidates[0].id}`;
      else if (candidates.length > 1) {
        review.push({ reason: 'ambiguous_title_match', record: r, candidates: candidates.map((c) => c.id) });
        continue;
      } else {
        // Same title+year already seen in this batch from another provider?
        for (const [k, rs] of clusters) {
          if (rs.some((x) => x.fields.title && normaliseTitle(x.fields.title) === t && yearOf(x) === y)) { key = k; break; }
        }
      }
    }

    if (!key) key = `new:${r.provider}:${r.externalId}`;
    if (!clusters.has(key)) {
      clusters.set(key, []);
      clusterFilm.set(key, key.startsWith('film:') ? key.slice(5) : null);
    }
    clusters.get(key)!.push(r);
    for (const [ns, id] of Object.entries(r.crossReferences)) crossRefKey.set(`${ns}:${id}`, key);
  }

  const resolved: ResolvedFilm[] = [];
  for (const [key, rs] of clusters) {
    const fields: Partial<ProviderFilmFields> = {};
    const provenance: ResolvedFilm['provenance'] = {};
    // rs is already in precedence order; first provider to supply a field wins.
    for (const r of rs) {
      for (const [k, v] of Object.entries(r.fields) as [keyof ProviderFilmFields, unknown][]) {
        if (v === undefined || v === null || (Array.isArray(v) && v.length === 0) || k in fields) continue;
        (fields as Record<string, unknown>)[k] = v;
        provenance[k] = r.provider;
      }
    }
    resolved.push({
      filmId: clusterFilm.get(key) ?? null,
      fields,
      provenance,
      externalIds: rs.map((r) => ({ provider: r.provider, externalId: r.externalId })),
      records: rs,
    });
  }
  return { resolved, review };
}
