import { INTEREST_EXPONENT, interestStrength, interestWindow, median, pageviewsUrl, parsePageviews, parseWikidata, wikidataQuery } from './interest';
import { prior, weeklyRetention } from './pulse';

describe('Audience interest', () => {
  it('scales strength by about 1.4 per doubling of page views, kept within 0.6 to 1.8', () => {
    expect(INTEREST_EXPONENT).toBeCloseTo(Math.log2(1.4), 6);
    expect(interestStrength(1000, 1000)).toBe(1);
    expect(interestStrength(2000, 1000)).toBeCloseTo(1.4, 3);
    expect(interestStrength(500, 1000)).toBeCloseTo(1 / 1.4, 2);
    expect(interestStrength(1_000_000, 1000)).toBe(1.8);
    expect(interestStrength(1, 1000)).toBe(0.6);
    expect(interestStrength(0, 1000)).toBe(1);
    expect(interestStrength(1000, 0)).toBe(1);
    expect(median([0, 3, 1, 2])).toBe(2);
  });

  it('counts the month before release, or the latest month for a film not out yet', () => {
    const now = new Date('2026-11-12T10:00:00Z');
    const out = interestWindow(new Date('2026-10-01T00:00:00Z'), now);
    expect(out.end.toISOString().slice(0, 10)).toBe('2026-09-30');
    expect(out.start.toISOString().slice(0, 10)).toBe('2026-09-01');
    const soon = interestWindow(new Date('2026-12-18T00:00:00Z'), now);
    expect(soon.end.toISOString().slice(0, 10)).toBe('2026-11-11');
    expect(pageviewsUrl('Oppenheimer (film)', out.start, out.end)).toBe('https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/Oppenheimer_(film)/daily/20260901/20260930');
  });

  it('reads Wikimedia and Wikidata responses defensively', () => {
    expect(parsePageviews({ items: [{ views: 10 }, { views: 5 }, { views: -1 }, {}] })).toBe(15);
    expect(parsePageviews({})).toBe(0);
    expect(parsePageviews(null)).toBe(0);
    const hit = parseWikidata({ results: { bindings: [{ film: { value: 'http://www.wikidata.org/entity/Q108839994' }, article: { value: 'https://en.wikipedia.org/wiki/Oppenheimer_(film)' }, series: { value: 'false' } }] } });
    expect(hit).toEqual({ qid: 'Q108839994', article: 'Oppenheimer (film)', series: false });
    expect(parseWikidata({ results: { bindings: [] } })).toBeNull();
    expect(wikidataQuery('Say "Hi"', 2026)).toContain('"Say \\"Hi\\""@en');
    expect(wikidataQuery('X', 2026)).toContain('YEAR(?date) >= 2025');
  });

  it('feeds the prior with a plain-English driver, and treats series films as front-loaded', () => {
    const film = { id: 'f', title: 'F', genres: ['Drama'], certificate: '15', releaseDate: new Date('2026-11-06T00:00:00Z') };
    const show = { venueId: 'v', filmId: 'f', capacity: 200, slot: 'fri-sat-evening' as const, dayOfWeek: 5, filmWeek: 1, formats: [], schoolHoliday: null };
    const base = prior(show, { film }).mu;
    const strong = prior(show, { film, interest: { views: 4000, typical: 1000, strength: interestStrength(4000, 1000), source: 'wikipedia' } });
    // 4 times the views would be 1.4 squared (1.96); the cap holds it at 1.8.
    expect(strong.mu).toBeCloseTo(base * 1.8, 5);
    const d = strong.drivers.find((x) => x.label === 'Strong audience interest')!;
    expect(d.explanation).toContain('4.0 times the typical film');
    expect(d.explanation).toContain('Wikimedia, CC0');
    const demo = prior(show, { film, interest: { views: 500, typical: 1000, strength: interestStrength(500, 1000), source: 'demo' } });
    expect(demo.drivers.find((x) => x.label === 'Quieter audience interest')!.explanation).toContain('demo figures');
    expect(weeklyRetention({ ...film, series: true }).kind).toBe('a sequel or series film');
    expect(weeklyRetention({ ...film, genres: ['Family'], series: true }).factor).toBe(0.67);
  });
});
