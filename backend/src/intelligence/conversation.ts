import type { PrismaClient } from '@prisma/client';
import { median } from './interest';

/*
 * Social conversation: how much people are talking about each film on Bluesky this week, and
 * whether that talk is growing. Bluesky is an open network (AT Protocol); its public search
 * needs no key, and its developer guidelines ask services to honour deletions, which we do by
 * storing only counts and post links, never post text. Post text is fetched live when an
 * operator opens it, so a deleted post simply stops appearing. See docs/pulse-data-sources.md.
 *
 * Reddit (commercial use needs a paid agreement), X (paid API), TikTok (research API is
 * non-commercial) and YouTube (no derived metrics) are not used.
 *
 * Bluesky is small next to X or TikTok and cannot yet be backtested against UK openings (it was
 * tiny in 2023), so its effect on forecasts is capped at ±8% until an operator's own sales show
 * it helps. Its main job is early warning: talk that is climbing fast means walk-ups.
 */

const DAY = 86400_000;
const API = 'https://api.bsky.app/xrpc';
/** Most a film's conversation can move a forecast either way, until validated on an operator's sales. */
export const CONVERSATION_CAP = 0.08;
/** Smoothing for week-on-week momentum so a jump from 1 post to 4 is not "4 times". */
const MOMENTUM_SMOOTHING = 5;
/** A week of talk this many times the week before counts as climbing (for alerts). */
export const CLIMBING = 2;

export interface SearchPost {
  uri: string;
  author: { handle: string; labels?: { val: string }[] };
  record: { text?: string; labels?: { values?: { val: string }[] } };
  /** Moderation labels on the post (adult content and so on). */
  labels?: { val: string }[];
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  quoteCount?: number;
}

export interface SearchResult {
  posts: SearchPost[];
  hitsTotal?: number;
}

export interface ConversationFetcher {
  search(params: { q: string; since: string; until: string; sort: 'latest' | 'top'; limit: number }): Promise<SearchResult>;
  posts(uris: string[]): Promise<SearchPost[]>;
}

export const httpConversationFetcher: ConversationFetcher = {
  async search({ q, since, until, sort, limit }) {
    const qs = new URLSearchParams({ q, since, until, sort, limit: String(limit), lang: 'en' });
    const res = await fetch(`${API}/app.bsky.feed.searchPosts?${qs}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Bluesky search: ${res.status}`);
    return (await res.json()) as SearchResult;
  },
  async posts(uris) {
    if (!uris.length) return [];
    const qs = new URLSearchParams();
    for (const u of uris.slice(0, 25)) qs.append('uris', u);
    const res = await fetch(`${API}/app.bsky.feed.getPosts?${qs}`, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Bluesky posts: ${res.status}`);
    return ((await res.json()) as { posts: SearchPost[] }).posts ?? [];
  },
};

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();

/** Search phrase for a film: the title in quotes (quotes inside the title dropped). */
export function conversationQuery(title: string): string {
  return `"${title.replace(/["“”]/g, '').trim()}"`;
}

/**
 * A title is distinctive when a post naming it is almost certainly about the film: three or more
 * words, or a number or colon ("Zootopia 2", "Mission: Impossible"). One or two words
 * ("Wicked", "Oppenheimer", "Northbound") are also everyday words, names or places, so posts
 * naming them need a film word too.
 */
export function distinctiveTitle(title: string): boolean {
  const words = norm(title).split(' ').filter(Boolean);
  return words.length >= 3 || /[0-9:]/.test(title);
}

const FILM_WORDS = /\b(film|films|movie|movies|cinema|cinemas|trailer|screening|tickets?|imax|4dx|premiere|box office|watched|watching|saw it|odeon|vue|cineworld|picturehouse|everyman|showcase|review|director|cast|sequel|opening weekend)\b|#\w*(film|movie|cinema)\w*/i;

/** Is this post about the film? Bot accounts and posts that only share the word are left out. */
export function aboutFilm(post: SearchPost, title: string): boolean {
  if (/bot\b|bot\./i.test(post.author?.handle ?? '')) return false;
  const text = post.record?.text ?? '';
  if (!` ${norm(text)} `.includes(` ${norm(title)} `)) return false;
  return distinctiveTitle(title) || FILM_WORDS.test(text);
}

const ADULT_LABELS = new Set(['porn', 'sexual', 'nudity', 'graphic-media', 'gore', 'nsfl', '!hide', '!warn']);
const UNSHOWABLE = /#nsfw|\bnsfw\b|\bf+u+c+k|\bc+u+n+t|\bsh[i1]t|\bwank|\bporn|\bslut|\bwhore|\bn[i1]gg|\bf[a4]gg?ot|\bretard/i;

/**
 * Fit to show an operator: no adult or graphic labels (on the post, its record or its author),
 * nothing tagged NSFW, no strong swearing or slurs. Counts still include every post about the
 * film; this only decides which posts appear in the portal and Ask Pulse.
 */
export function showable(post: SearchPost): boolean {
  const labels = [...(post.labels ?? []), ...(post.record?.labels?.values ?? []), ...(post.author?.labels ?? [])].map((l) => l.val);
  return !labels.some((l) => ADULT_LABELS.has(l)) && !UNSHOWABLE.test(post.record?.text ?? '');
}

export const engagementOf = (p: SearchPost) => (p.likeCount ?? 0) + (p.repostCount ?? 0) + (p.replyCount ?? 0) + (p.quoteCount ?? 0);

/** Week's posts about the film: the search total scaled by the share of a sample that is really about it. */
export function estimatePosts(result: SearchResult, title: string): { posts: number; relevant: SearchPost[] } {
  const sample = result.posts ?? [];
  const relevant = sample.filter((p) => aboutFilm(p, title));
  const total = Math.max(result.hitsTotal ?? sample.length, sample.length);
  if (!sample.length) return { posts: 0, relevant };
  return { posts: Math.round(total * (relevant.length / sample.length)), relevant };
}

/** This week against last, smoothed: 1 is flat, 2 is twice the talk. */
export function momentum(posts7: number, prev7: number): number {
  return Math.round(((posts7 + MOMENTUM_SMOOTHING) / (prev7 + MOMENTUM_SMOOTHING)) * 100) / 100;
}

/**
 * Forecast effect: more talk than the typical film on the programme lifts a little, less talk
 * trims a little, within ±8%. Elasticity 0.1 per doubling-ish (log scale), deliberately small.
 */
export function conversationStrength(posts7: number, typical: number): number {
  if (!(typical > 0)) return 1;
  const s = Math.pow((posts7 + MOMENTUM_SMOOTHING) / (typical + MOMENTUM_SMOOTHING), 0.1);
  return Math.round(Math.min(1 + CONVERSATION_CAP, Math.max(1 - CONVERSATION_CAP, s)) * 1000) / 1000;
}

export function postUrl(uri: string, handle: string): string {
  return `https://bsky.app/profile/${handle}/post/${uri.split('/').pop()}`;
}

export interface TopPost {
  uri: string;
  url: string;
  engagement: number;
}

/** One film's week on Bluesky: three searches (this week, last week, this week's most engaged posts). */
export async function filmConversation(fetcher: ConversationFetcher, title: string, now: Date): Promise<{ posts7: number; prev7: number; engagement7: number; top: TopPost[] }> {
  const q = conversationQuery(title);
  const iso = (d: Date) => d.toISOString();
  const end = new Date(Math.floor(now.getTime() / DAY) * DAY); // midnight UTC, so a day's figures are stable
  const mid = new Date(end.getTime() - 7 * DAY);
  const start = new Date(end.getTime() - 14 * DAY);
  const [week, before, top] = await Promise.all([
    fetcher.search({ q, since: iso(mid), until: iso(end), sort: 'latest', limit: 100 }),
    fetcher.search({ q, since: iso(start), until: iso(mid), sort: 'latest', limit: 100 }),
    fetcher.search({ q, since: iso(mid), until: iso(end), sort: 'top', limit: 25 }),
  ]);
  const w = estimatePosts(week, title);
  const b = estimatePosts(before, title);
  const best = (top.posts ?? []).filter((p) => aboutFilm(p, title));
  const shown = best.filter(showable);
  // Engagement: the latest sample's average, scaled to the week, floored at the top posts' total.
  const avg = w.relevant.length ? w.relevant.reduce((a, p) => a + engagementOf(p), 0) / w.relevant.length : 0;
  const engagement7 = Math.max(Math.round(avg * w.posts), best.reduce((a, p) => a + engagementOf(p), 0));
  return {
    posts7: w.posts,
    prev7: b.posts,
    engagement7,
    top: shown.slice(0, 5).map((p) => ({ uri: p.uri, url: postUrl(p.uri, p.author.handle), engagement: engagementOf(p) })),
  };
}

type Db = Pick<PrismaClient, 'film' | 'filmConversation'>;

/**
 * Daily cron: Bluesky talk for films out in the last 60 days or due in the next 60. Only films
 * with a matched Wikipedia article are searched (run refreshInterest first): that confirms a
 * real film, so a fictional or local title is never matched to unrelated posts. Searches are
 * shared across operators showing the same title. Failures keep yesterday's figures.
 */
export async function refreshConversation(db: Db, tenantId: string, now: Date, fetcher: ConversationFetcher = httpConversationFetcher, limit = 40, cache = new Map<string, Promise<Awaited<ReturnType<typeof filmConversation>>>>()): Promise<{ updated: number; failed: number }> {
  const films = await db.film.findMany({
    where: { tenantId, hidden: false, interest: { source: 'wikipedia' }, releaseDate: { gte: new Date(now.getTime() - 60 * DAY), lte: new Date(now.getTime() + 60 * DAY) } },
    select: { id: true, title: true },
    orderBy: { releaseDate: 'desc' },
    take: limit,
  });
  let updated = 0;
  let failed = 0;
  for (const f of films) {
    try {
      const key = norm(f.title);
      if (!cache.has(key)) cache.set(key, filmConversation(fetcher, f.title, now));
      const c = await cache.get(key)!;
      const data = { source: 'bluesky', query: conversationQuery(f.title), posts7: c.posts7, prev7: c.prev7, engagement7: c.engagement7, top: c.top as unknown as object };
      await db.filmConversation.upsert({ where: { filmId: f.id }, create: { tenantId, filmId: f.id, ...data }, update: data });
      updated++;
    } catch {
      failed++;
    }
  }
  return { updated, failed };
}

/**
 * Demo operators show fictional films nobody posts about, so they get made-up weekly counts that
 * follow each film's demo page views, always stored as source "demo" with no posts to show.
 */
export async function ensureDemoConversation(db: Pick<PrismaClient, 'tenant' | 'film' | 'filmConversation'>, tenants: string[]): Promise<number> {
  let written = 0;
  for (const slug of tenants) {
    const tenant = await db.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!tenant) continue;
    const films = await db.film.findMany({ where: { tenantId: tenant.id, conversation: null, interest: { source: 'demo' } }, select: { id: true, interest: { select: { views: true } } } });
    for (const f of films) {
      const h = hashOf(f.id);
      const posts7 = Math.round(((f.interest?.views ?? 18_000) / 18_000) * 40 * (0.7 + (h % 600) / 1000));
      // A few films climbing, most steady or easing, so the alerts have something to show.
      const trend = [0.35, 0.8, 1, 1, 1.15, 1.3][h % 6];
      const prev7 = Math.round(posts7 * trend);
      await db.filmConversation.create({ data: { tenantId: tenant.id, filmId: f.id, source: 'demo', query: null, posts7, prev7, engagement7: posts7 * (8 + (h % 9)), top: [] } });
      written++;
    }
  }
  return written;
}

function hashOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

export interface ConversationView {
  posts7: number;
  prev7: number;
  momentum: number;
  engagement7: number;
  typical: number;
  strength: number;
  source: 'bluesky' | 'demo';
}

/** Per-film conversation against the typical (median) film this operator shows. */
export function conversationViews(rows: { filmId: string; posts7: number; prev7: number; engagement7: number; source: string }[]): Map<string, ConversationView> {
  const typical = median(rows.map((r) => r.posts7));
  return new Map(rows.map((r) => [r.filmId, { posts7: r.posts7, prev7: r.prev7, momentum: momentum(r.posts7, r.prev7), engagement7: r.engagement7, typical, strength: conversationStrength(r.posts7, typical), source: r.source as 'bluesky' | 'demo' }]));
}
