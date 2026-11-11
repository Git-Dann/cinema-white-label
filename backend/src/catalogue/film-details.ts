/**
 * Rich film details for the film page: cast with photos and short biographies,
 * key crew, an About block and BBFC content advice (the Parents Guide).
 * Built from a TMDB /movie/{id} payload (append_to_response=release_dates,credits,keywords)
 * and stored as JSON on Film.details, so the customer API never calls TMDB.
 */

export interface CastMember {
  id: number;
  name: string;
  character: string | null;
  /** TMDB image path, e.g. "/abc.jpg". Turned into an image URL by the DTO. */
  profilePath: string | null;
  /** Short biography for the cast list (two sentences). */
  biography: string | null;
  /** Fuller biography for the person page. */
  fullBiography?: string | null;
  /** YYYY-MM-DD, or null when TMDB doesn't know. Undefined on rows imported before it was stored. */
  birthday?: string | null;
  deathday?: string | null;
  placeOfBirth?: string | null;
}

/** What the importer keeps about a person between runs (one TMDB call per person, ever). */
export interface PersonInfo {
  biography: string | null;
  fullBiography: string | null;
  birthday: string | null;
  deathday: string | null;
  placeOfBirth: string | null;
}

export function personInfo(p: any): PersonInfo {
  const full = (p?.biography ?? '').replace(/\s+\n/g, '\n').trim();
  return {
    biography: shortBio(full),
    fullBiography: full ? (full.length > 2000 ? full.slice(0, 2000).replace(/\s+\S*$/, '') + '…' : full) : null,
    birthday: /^\d{4}-\d{2}-\d{2}$/.test(p?.birthday ?? '') ? p.birthday : null,
    deathday: /^\d{4}-\d{2}-\d{2}$/.test(p?.deathday ?? '') ? p.deathday : null,
    placeOfBirth: p?.place_of_birth || null,
  };
}

export interface CrewMember {
  name: string;
  job: string;
}

export interface FilmAbout {
  originalTitle: string | null;
  spokenLanguages: string[];
  originCountries: string[];
  productionCompanies: string[];
  status: string | null;
  budget: number | null;
  keywords: string[];
}

export const ADVICE_LEVELS = ['Strong', 'Moderate', 'Mild', 'Contains'] as const;
export type AdviceLevel = (typeof ADVICE_LEVELS)[number];

export interface ContentAdvice {
  category: string;
  level: AdviceLevel;
  /** The BBFC wording, e.g. "strong bloody violence". */
  text: string;
}

export interface FilmDetails {
  cast: CastMember[];
  crew: CrewMember[];
  about: FilmAbout | null;
  advice: ContentAdvice[];
  /** Where the advice came from: the provider feed, or typed in by the operator (kept on refresh). */
  adviceSource?: 'provider' | 'operator';
}

export const EMPTY_DETAILS: FilmDetails = { cast: [], crew: [], about: null, advice: [] };
export const CAST_LIMIT = 12;
/** Biographies are fetched for the first few cast members only (one TMDB call each). */
export const BIO_LIMIT = 8;

const CREW_JOBS = ['Director', 'Screenplay', 'Writer', 'Story', 'Producer', 'Original Music Composer', 'Director of Photography', 'Editor'];

/** Reads stored JSON defensively: older rows hold {} or nothing. */
export function readDetails(raw: unknown): FilmDetails {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Partial<FilmDetails>;
  return {
    cast: Array.isArray(d.cast) ? d.cast : [],
    crew: Array.isArray(d.crew) ? d.crew : [],
    about: d.about ?? null,
    advice: Array.isArray(d.advice) ? d.advice : [],
    adviceSource: d.adviceSource === 'operator' ? 'operator' : 'provider',
  };
}

/** First two sentences or ~280 characters, whichever is shorter, at a word boundary. */
export function shortBio(text: string | null | undefined): string | null {
  const t = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return null;
  const sentences = t.match(/[^.!?]+[.!?]+/g) ?? [t];
  let out = sentences.slice(0, 2).join('').trim();
  if (out.length > 280) out = out.slice(0, 280).replace(/\s+\S*$/, '') + '…';
  return out;
}

export function buildFilmDetails(m: any, people: Map<number, PersonInfo>): FilmDetails {
  const cast: CastMember[] = (m.credits?.cast ?? [])
    .slice()
    .sort((a: any, b: any) => (a.order ?? 999) - (b.order ?? 999))
    .slice(0, CAST_LIMIT)
    .map((c: any) => ({
      id: c.id,
      name: c.name,
      character: c.character || null,
      profilePath: c.profile_path ?? null,
      ...(people.get(c.id) ?? { biography: null }),
    }));

  const crew: CrewMember[] = [];
  for (const job of CREW_JOBS) {
    for (const c of m.credits?.crew ?? []) {
      if (c.job !== job || crew.some((x) => x.name === c.name)) continue;
      if (crew.filter((x) => x.job === job).length >= (job === 'Producer' ? 2 : 3)) continue;
      crew.push({ name: c.name, job });
    }
  }

  const about: FilmAbout = {
    originalTitle: m.original_title && m.original_title !== m.title ? m.original_title : null,
    spokenLanguages: (m.spoken_languages ?? []).map((l: any) => l.english_name || l.name).filter(Boolean),
    originCountries: (m.production_countries ?? []).map((c: any) => c.name).filter(Boolean),
    productionCompanies: (m.production_companies ?? []).slice(0, 4).map((c: any) => c.name).filter(Boolean),
    status: m.status ?? null,
    budget: m.budget > 0 ? m.budget : null,
    keywords: (m.keywords?.keywords ?? []).slice(0, 10).map((k: any) => k.name),
  };

  return { cast, crew, about, advice: contentAdvice(m), adviceSource: 'provider' };
}

/**
 * BBFC content advice from the GB release (TMDB "descriptors"), grouped the way
 * parents read it: one card per category with the strongest level found.
 */
export function contentAdvice(m: any): ContentAdvice[] {
  const gb = (m.release_dates?.results ?? []).find((r: any) => r.iso_3166_1 === 'GB');
  const descriptors: string[] = (gb?.release_dates ?? []).flatMap((d: any) => (Array.isArray(d.descriptors) ? d.descriptors : []));
  const notes: string[] = (gb?.release_dates ?? []).map((d: any) => d.note).filter((n: any) => typeof n === 'string' && /violence|language|sex|threat|drug|horror|injury/i.test(n));
  const phrases = [...descriptors, ...notes.flatMap((n) => n.split(/,|;| and /))].map((p) => p.trim()).filter(Boolean);
  const byCategory = new Map<string, ContentAdvice>();
  const rank: Record<AdviceLevel, number> = { Strong: 3, Moderate: 2, Mild: 1, Contains: 0 };
  for (const text of phrases) {
    const category = adviceCategory(text);
    const level = adviceLevel(text);
    const prev = byCategory.get(category);
    if (!prev || rank[level] > rank[prev.level]) byCategory.set(category, { category, level, text: text.toLowerCase() });
  }
  return [...byCategory.values()].sort((a, b) => rank[b.level] - rank[a.level]);
}

export function adviceCategory(text: string): string {
  const t = text.toLowerCase();
  if (/violen|gore|bloody|blood|injury|fight/.test(t)) return 'Violence';
  if (/language|swear|profan/.test(t)) return 'Language';
  if (/sex|nudity|nude/.test(t)) return 'Sex & nudity';
  if (/threat|horror|scar|frighten|peril|terror|disturbing/.test(t)) return 'Frightening & intense';
  if (/drug|alcohol|smok|drink/.test(t)) return 'Alcohol & drugs';
  if (/discriminat|racis|homophob/.test(t)) return 'Discrimination';
  if (/self-harm|self harm|suicid/.test(t)) return 'Self-harm';
  const s = text.trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function adviceLevel(text: string): AdviceLevel {
  const t = text.toLowerCase();
  if (/very strong|strong|sustained|graphic|extreme/.test(t)) return 'Strong';
  if (/moderate/.test(t)) return 'Moderate';
  if (/mild|infrequent|brief|some|occasional|implied/.test(t)) return 'Mild';
  return 'Contains';
}

/** Plain-English meaning of a UK certificate, the first card in the Parents Guide. */
export function certificateMeaning(cert: string): string | null {
  switch (cert.toUpperCase()) {
    case 'U': return 'Suitable for all';
    case 'PG': return 'Parental guidance';
    case '12A': return '12 and over, or with an adult';
    case '12': return '12 and over';
    case '15': return '15 and over';
    case '18': return 'Adults only';
    default: return null;
  }
}
