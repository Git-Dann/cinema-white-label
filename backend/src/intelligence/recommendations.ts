export interface RecFilm {
  id: string;
  title: string;
  genres: string[];
  certificate: string;
}

/** Jaccard similarity of two sets. */
export const jaccard = <T>(a: Set<T>, b: Set<T>) => {
  if (!a.size && !b.size) return 0;
  let both = 0;
  for (const x of a) if (b.has(x)) both++;
  return both / (a.size + b.size - both);
};

/** For each film, the set of customers who booked it. */
export function audiences(bookings: { customerId: string; filmId: string }[]): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const b of bookings) {
    const s = m.get(b.filmId) ?? new Set<string>();
    s.add(b.customerId);
    m.set(b.filmId, s);
  }
  return m;
}

/** Genre and certificate likeness, 0 to 1. */
export function contentSimilarity(a: RecFilm, b: RecFilm): number {
  const g = jaccard(new Set(a.genres.map((x) => x.toLowerCase())), new Set(b.genres.map((x) => x.toLowerCase())));
  return Math.min(1, 0.8 * g + (a.certificate === b.certificate ? 0.2 : 0));
}

export interface Recommendation {
  film: RecFilm;
  score: number;
  reason: string;
}

/**
 * Films for someone who booked `seen`: co-booking (people who booked A also booked B)
 * blended with genre and certificate likeness for films nobody has co-booked yet.
 * With nothing seen, the most popular films.
 */
export function recommend(seen: RecFilm[], candidates: RecFilm[], aud: Map<string, Set<string>>, popularity: Map<string, number>, limit = 10): Recommendation[] {
  const seenIds = new Set(seen.map((f) => f.id));
  const maxPop = Math.max(1, ...popularity.values());
  const out: Recommendation[] = [];
  for (const c of candidates) {
    if (seenIds.has(c.id)) continue;
    if (!seen.length) {
      const p = (popularity.get(c.id) ?? 0) / maxPop;
      out.push({ film: c, score: Math.round(p * 1000) / 1000, reason: 'Popular at your cinema right now' });
      continue;
    }
    let best = { s: 0, co: 0, like: 0, via: seen[0] };
    for (const s of seen) {
      const co = jaccard(aud.get(s.id) ?? new Set(), aud.get(c.id) ?? new Set());
      const like = contentSimilarity(s, c);
      const score = co + 0.3 * like;
      if (score > best.s) best = { s: score, co, like, via: s };
    }
    const pop = 0.05 * ((popularity.get(c.id) ?? 0) / maxPop);
    const score = best.s + pop;
    if (score <= 0) continue;
    const shared = c.genres.filter((g) => best.via.genres.includes(g)).slice(0, 2);
    const reason = best.co >= 0.05 ? `People who booked ${best.via.title} also booked this` : shared.length ? `Like ${best.via.title}: ${shared.join(', ')}` : `Because you booked ${best.via.title}`;
    out.push({ film: c, score: Math.round(score * 1000) / 1000, reason });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit);
}

/** Films most often co-booked with one film, with a content fallback. */
export function alsoBooked(film: RecFilm, candidates: RecFilm[], aud: Map<string, Set<string>>, limit = 8): Recommendation[] {
  return candidates
    .filter((c) => c.id !== film.id)
    .map((c) => {
      const co = jaccard(aud.get(film.id) ?? new Set(), aud.get(c.id) ?? new Set());
      const like = contentSimilarity(film, c);
      return { film: c, score: Math.round((co + 0.3 * like) * 1000) / 1000, reason: co >= 0.05 ? `Often booked by people who booked ${film.title}` : `Similar to ${film.title}` };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}
