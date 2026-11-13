import { aboutFilm, showable, CONVERSATION_CAP, conversationQuery, conversationStrength, conversationViews, distinctiveTitle, estimatePosts, filmConversation, momentum, postUrl, SearchPost } from './conversation';
import { prior } from './pulse';

const post = (text: string, handle = 'someone.bsky.social', likes = 0): SearchPost => ({ uri: `at://did:plc:x/app.bsky.feed.post/${Math.random().toString(36).slice(2)}`, author: { handle }, record: { text }, likeCount: likes, repostCount: 0, replyCount: 0 });

describe('Social conversation (Bluesky)', () => {
  it('only counts posts about the film', () => {
    expect(distinctiveTitle('Wicked')).toBe(false);
    expect(distinctiveTitle('Elemental')).toBe(false);
    expect(distinctiveTitle('Oppenheimer')).toBe(false);
    expect(distinctiveTitle('Northbound')).toBe(false);
    expect(distinctiveTitle('Zootopia 2')).toBe(true);
    expect(distinctiveTitle('Mission: Impossible')).toBe(true);
    expect(distinctiveTitle('The Old Oak')).toBe(true);
    // A common word needs a film word nearby.
    expect(aboutFilm(post('That was a wicked goal'), 'Wicked')).toBe(false);
    expect(aboutFilm(post('Finally saw Wicked at the cinema, loved it'), 'Wicked')).toBe(true);
    expect(aboutFilm(post('Wicked trailer just dropped'), 'Wicked')).toBe(true);
    // Whole words only, and bots are left out.
    expect(aboutFilm(post('Wickedness at the movies'), 'Wicked')).toBe(false);
    expect(aboutFilm(post('Oppenheimer tickets on sale', 'newsbot.bsky.social'), 'Oppenheimer')).toBe(false);
    expect(aboutFilm(post('Rewatching Oppenheimer tonight'), 'Oppenheimer')).toBe(false);
    expect(aboutFilm(post('Rewatching Oppenheimer tonight, what a film'), 'Oppenheimer')).toBe(true);
    expect(aboutFilm(post('Northbound traffic on the M6 is at a standstill'), 'Northbound')).toBe(false);
    expect(conversationQuery('The "Big" One')).toBe('"The Big One"');
  });

  it('never shows adult, graphic or abusive posts, while still counting them', () => {
    expect(showable(post('Watched Spider-Man: Brand New Day, great film'))).toBe(true);
    expect(showable(post('Spider-Man fan art #NSFWArt #SpiderManBND'))).toBe(false);
    expect(showable({ ...post('Spider-Man: Brand New Day'), labels: [{ val: 'sexual' }] })).toBe(false);
    expect(showable({ ...post('Spider-Man: Brand New Day'), record: { text: 'Spider-Man: Brand New Day', labels: { values: [{ val: 'porn' }] } } })).toBe(false);
    expect(showable({ ...post('Spider-Man: Brand New Day'), author: { handle: 'x.bsky.social', labels: [{ val: 'porn' }] } })).toBe(false);
    expect(showable(post('Fuck it, watching The Odyssey again'))).toBe(false);
    expect(showable(post('Scunthorpe screening of The Odyssey'))).toBe(true);
  });

  it('scales the search total by the share of the sample that is really about the film', () => {
    const sample = [post('Saw Wicked at the cinema'), post('wicked weather'), post('Wicked movie was great'), post('so wicked')];
    expect(estimatePosts({ posts: sample, hitsTotal: 400 }, 'Wicked').posts).toBe(200);
    expect(estimatePosts({ posts: [], hitsTotal: 0 }, 'Wicked').posts).toBe(0);
    expect(estimatePosts({ posts: sample }, 'Wicked').posts).toBe(2);
  });

  it('smooths momentum and keeps the forecast effect within ±8%', () => {
    expect(momentum(0, 0)).toBe(1);
    expect(momentum(4, 1)).toBe(1.5);
    expect(momentum(195, 95)).toBe(2);
    expect(conversationStrength(100, 100)).toBe(1);
    expect(conversationStrength(200, 100)).toBeGreaterThan(1);
    // Twice the typical talk is a small lift, not the cap; about 8 times reaches it.
    expect(conversationStrength(195, 95)).toBeCloseTo(1.026, 3);
    expect(conversationStrength(795, 95)).toBeCloseTo(1.08, 3);
    expect(conversationStrength(395, 95)).toBeLessThan(1 + CONVERSATION_CAP);
    expect(conversationStrength(1_000_000, 10)).toBe(1 + CONVERSATION_CAP);
    expect(conversationStrength(0, 10_000)).toBe(1 - CONVERSATION_CAP);
    expect(conversationStrength(5, 0)).toBe(1);
    const views = conversationViews([
      { filmId: 'a', posts7: 300, prev7: 100, engagement7: 900, source: 'bluesky' },
      { filmId: 'b', posts7: 30, prev7: 40, engagement7: 60, source: 'bluesky' },
      { filmId: 'c', posts7: 60, prev7: 60, engagement7: 100, source: 'bluesky' },
    ]);
    expect(views.get('c')!.typical).toBe(60);
    expect(views.get('a')!.strength).toBeGreaterThan(1);
    expect(views.get('b')!.strength).toBeLessThan(1);
    expect(views.get('a')!.momentum).toBe(2.9);
  });

  it('builds a week from three searches and keeps links, not text', async () => {
    const calls: { since: string; until: string; sort: string }[] = [];
    const fetcher = {
      async search(p: { q: string; since: string; until: string; sort: 'latest' | 'top'; limit: number }) {
        calls.push(p);
        if (p.sort === 'top') return { posts: [post('Oppenheimer was an incredible film', 'a.bsky.social', 50), post('Oppenheimer IMAX tickets', 'b.bsky.social', 20)] };
        return p.since.startsWith('2026-11-05') ? { posts: [post('Oppenheimer at the cinema!', 'c.bsky.social', 3)], hitsTotal: 120 } : { posts: [post('Oppenheimer trailer soon')], hitsTotal: 40 };
      },
      async posts() {
        return [];
      },
    };
    const c = await filmConversation(fetcher, 'Oppenheimer', new Date('2026-11-12T15:00:00Z'));
    expect(calls.map((x) => `${x.sort} ${x.since.slice(0, 10)}..${x.until.slice(0, 10)}`).sort()).toEqual(['latest 2026-10-29..2026-11-05', 'latest 2026-11-05..2026-11-12', 'top 2026-11-05..2026-11-12']);
    expect(c.posts7).toBe(120);
    expect(c.prev7).toBe(40);
    expect(c.engagement7).toBe(360);
    expect(c.top[0]).toEqual({ uri: expect.stringMatching(/^at:\/\//), url: expect.stringMatching(/^https:\/\/bsky\.app\/profile\/a\.bsky\.social\/post\//), engagement: 50 });
    expect(JSON.stringify(c)).not.toMatch(/incredible/);
    expect(postUrl('at://did:plc:x/app.bsky.feed.post/abc', 'me.bsky.social')).toBe('https://bsky.app/profile/me.bsky.social/post/abc');
  });

  it('nudges the prior with a labelled driver, and only a little', () => {
    const film = { id: 'f', title: 'Talked About', genres: ['Drama'], certificate: '12A', releaseDate: new Date('2026-11-01T00:00:00Z') };
    const show = { venueId: 'v', filmId: 'f', capacity: 100, slot: 'fri-sat-evening' as const, dayOfWeek: 5, filmWeek: 2, formats: [], schoolHoliday: null };
    const plain = prior(show, { film });
    const talk = prior(show, { film, conversation: { posts7: 900, prev7: 300, momentum: 2.98, engagement7: 5000, typical: 50, strength: 1.08, source: 'bluesky' } });
    expect(talk.mu / plain.mu).toBeCloseTo(1.08, 3);
    const d = talk.drivers.find((x) => x.label === 'People are talking')!;
    expect(d.explanation).toMatch(/900 posts about it on Bluesky/);
    expect(d.explanation).toMatch(/climbing/);
  });
});
