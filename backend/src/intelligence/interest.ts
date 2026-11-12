import type { PrismaClient } from '@prisma/client';

/*
 * Audience interest: how much attention a film is getting before it opens, from English
 * Wikipedia page views (Wikimedia Foundation, CC0) with the article found through Wikidata
 * (CC0). Both are free for commercial use. See docs/pulse-data-sources.md, section 3.6.
 *
 * Evidence: across 42 matched 2023 films, doubling page views a month out went with a UK
 * opening about 1.4 times larger once release width is counted (Mestyan, Yasseri and
 * Kertesz 2013 found the same signal for US openings).
 */

const DAY = 86400_000;
/** Opening ratio per doubling of page views (research section 3.6, width-adjusted). */
export const INTEREST_PER_DOUBLING = 1.4;
export const INTEREST_EXPONENT = Math.log2(INTEREST_PER_DOUBLING);
export const INTEREST_WINDOW_DAYS = 30;
/** Wikimedia asks automated clients to identify themselves; no personal details. */
const USER_AGENT = 'Seatfold-Pulse/1.0 (https://seatfold.uk; cinema demand forecasting)';

export type InterestSource = 'wikipedia' | 'demo';

export interface FilmInterestRow {
  filmId: string;
  source: InterestSource;
  article: string | null;
  views: number;
  windowEnd: Date;
  series: boolean;
}

/** Film strength from page views against the typical (median) film: ×1.4 per doubling, kept within 0.6 to 1.8. */
export function interestStrength(views: number, typical: number): number {
  if (!(views > 0) || !(typical > 0)) return 1;
  const s = Math.pow(views / typical, INTEREST_EXPONENT);
  return Math.round(Math.min(1.8, Math.max(0.6, s)) * 1000) / 1000;
}

export function median(xs: number[]): number {
  const a = xs.filter((x) => x > 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** The 30-day window that counts: the month before release, or the latest month once it is out. */
export function interestWindow(releaseDate: Date, now: Date): { start: Date; end: Date } {
  const end = new Date(Math.min(now.getTime() - DAY, releaseDate.getTime() - DAY));
  return { start: new Date(end.getTime() - (INTEREST_WINDOW_DAYS - 1) * DAY), end };
}

const ymd = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, '');

export function pageviewsUrl(article: string, start: Date, end: Date): string {
  return `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${encodeURIComponent(article.replace(/ /g, '_'))}/daily/${ymd(start)}/${ymd(end)}`;
}

/** Sums the daily views in a Wikimedia pageviews response. */
export function parsePageviews(json: unknown): number {
  const items = (json as { items?: { views?: unknown }[] })?.items;
  if (!Array.isArray(items)) return 0;
  return items.reduce((a, i) => a + (typeof i.views === 'number' && i.views > 0 ? i.views : 0), 0);
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

/** Wikidata query: a film (or subclass) with this English title released within a year of ours, and its English article. */
export function wikidataQuery(title: string, releaseYear: number): string {
  return `SELECT ?film ?article ?series WHERE {
  ?film rdfs:label "${esc(title)}"@en ; wdt:P31/wdt:P279* wd:Q11424 ; wdt:P577 ?date .
  FILTER(YEAR(?date) >= ${releaseYear - 1} && YEAR(?date) <= ${releaseYear + 1})
  ?article schema:about ?film ; schema:isPartOf <https://en.wikipedia.org/> .
  OPTIONAL { ?film wdt:P179 ?s }
  OPTIONAL { ?film wdt:P155 ?p }
  BIND(BOUND(?s) || BOUND(?p) AS ?series)
} LIMIT 3`;
}

/** First match from a Wikidata SPARQL response: the article title and whether the film is part of a series or a sequel. */
export function parseWikidata(json: unknown): { qid: string; article: string; series: boolean } | null {
  const rows = (json as { results?: { bindings?: Record<string, { value: string }>[] } })?.results?.bindings;
  const row = Array.isArray(rows) ? rows.find((r) => r.article?.value) : undefined;
  if (!row) return null;
  const article = decodeURIComponent(row.article.value.replace('https://en.wikipedia.org/wiki/', '')).replace(/_/g, ' ');
  return { qid: row.film?.value.split('/').pop() ?? '', article, series: row.series?.value === 'true' };
}

export interface InterestFetcher {
  wikidata(query: string): Promise<unknown>;
  pageviews(url: string): Promise<unknown>;
}

export const httpInterestFetcher: InterestFetcher = {
  async wikidata(query) {
    const res = await fetch(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(query)}`, { headers: { 'User-Agent': USER_AGENT, accept: 'application/sparql-results+json' }, signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Wikidata: ${res.status}`);
    return res.json();
  },
  async pageviews(url) {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: AbortSignal.timeout(10_000) });
    if (res.status === 404) return { items: [] }; // no views recorded yet
    if (!res.ok) throw new Error(`Wikimedia pageviews: ${res.status}`);
    return res.json();
  },
};

type Db = Pick<PrismaClient, 'film' | 'filmInterest'>;

/**
 * Daily cron: page views for films released in the last 60 days or due in the next 120.
 * A film with no Wikipedia article (a fictional or very small release) is left neutral.
 * Failures leave the previous figures in place.
 */
export async function refreshInterest(db: Db, tenantId: string, now: Date, fetcher: InterestFetcher = httpInterestFetcher, limit = 60): Promise<{ updated: number; unmatched: number; failed: number }> {
  const films = await db.film.findMany({
    where: { tenantId, hidden: false, releaseDate: { gte: new Date(now.getTime() - 60 * DAY), lte: new Date(now.getTime() + 120 * DAY) } },
    select: { id: true, title: true, releaseDate: true, interest: { select: { article: true, source: true, series: true } } },
    orderBy: { releaseDate: 'desc' },
    take: limit,
  });
  let updated = 0;
  let unmatched = 0;
  let failed = 0;
  for (const f of films) {
    // Demo figures stand in only until a real article is found: real films always get real page views.
    try {
      let article = f.interest?.source === 'wikipedia' ? f.interest.article : null;
      let series = f.interest?.source === 'wikipedia' ? f.interest.series : false;
      if (!article) {
        const hit = parseWikidata(await fetcher.wikidata(wikidataQuery(f.title, f.releaseDate.getUTCFullYear())));
        if (!hit) {
          unmatched++; // keeps any demo figures (a fictional demo film has no article)
          continue;
        }
        article = hit.article;
        series = hit.series;
      }
      const w = interestWindow(f.releaseDate, now);
      const views = parsePageviews(await fetcher.pageviews(pageviewsUrl(article, w.start, w.end)));
      await db.filmInterest.upsert({
        where: { filmId: f.id },
        create: { tenantId, filmId: f.id, source: 'wikipedia', article, series, views, windowEnd: w.end },
        update: { source: 'wikipedia', article, series, views, windowEnd: w.end },
      });
      updated++;
    } catch {
      failed++;
    }
  }
  return { updated, unmatched, failed };
}

/**
 * Demo operators show fictional films with no Wikipedia article, so they get made-up page
 * views, always stored with source "demo". They follow each film's demo sales so the story
 * hangs together: films that sold above the norm get more views.
 */
export async function ensureDemoInterest(db: Pick<PrismaClient, 'tenant' | 'film' | 'filmInterest' | 'showOutcome'>, tenants: string[], slotBase: Record<string, number>, now: Date = new Date()): Promise<number> {
  let written = 0;
  for (const slug of tenants) {
    const tenant = await db.tenant.findUnique({ where: { slug }, select: { id: true } });
    if (!tenant) continue;
    const films = await db.film.findMany({ where: { tenantId: tenant.id, interest: null }, select: { id: true, releaseDate: true } });
    if (!films.length) continue;
    const rows = await db.showOutcome.findMany({ where: { tenantId: tenant.id, source: 'demo' }, select: { filmId: true, admissions: true, capacity: true, slot: true } });
    for (const f of films) {
      const mine = rows.filter((r) => r.filmId === f.id);
      const expected = mine.reduce((a, r) => a + r.capacity * (slotBase[r.slot] ?? 0.2), 0);
      const ratio = expected > 0 ? mine.reduce((a, r) => a + r.admissions, 0) / expected : 1;
      const wobble = 0.85 + ((hashOf(f.id) % 1000) / 1000) * 0.3;
      const views = Math.round(18_000 * Math.pow(Math.max(0.2, ratio), 1 / INTEREST_EXPONENT) * wobble);
      await db.filmInterest.create({ data: { tenantId: tenant.id, filmId: f.id, source: 'demo', article: null, views, windowEnd: interestWindow(f.releaseDate, now).end } });
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
