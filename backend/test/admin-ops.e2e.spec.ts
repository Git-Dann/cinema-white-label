import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { api, createApp, findSeats, guest, T } from './harness';
import { PrismaService } from '../src/common/prisma.service';

describe('operations: cinema today, team and content advice (integration)', () => {
  let app: INestApplication;
  let admin: string;
  let editor: string;
  const A = '/v1/admin/t/northlight';
  const login = (email: string, password: string) => request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email, password });

  beforeAll(async () => {
    app = await createApp();
    admin = (await login('admin@northlight.example', 'operator-dev-password').expect(200)).body.token;
    editor = (await login('editor@northlight.example', 'editor-dev-password').expect(200)).body.token;
  });
  afterAll(async () => app.close());

  it("lists a cinema's shows for a day with seats sold, held and capacity", async () => {
    const { screening, seatIds } = await findSeats(app, 2, { minHoursAhead: 2 });
    const venueId = screening.venue.id;
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: screening.venue.timeZone ?? 'Europe/London' }).format(new Date(screening.startsAt));
    const before = (await api(app, admin).get(`${A}/venues/${venueId}/today?date=${day}`).expect(200)).body;
    const show = before.shows.find((s: any) => s.id === screening.id);
    expect(show).toMatchObject({ screen: expect.any(String), film: { title: expect.any(String) } });
    expect(show.capacity).toBeGreaterThan(0);
    expect(before.totals.shows).toBe(before.shows.length);

    const token = await guest(app);
    await api(app, token).post(`${T}/holds`, { screeningId: screening.id, seatIds }).expect(201);
    const after = (await api(app, admin).get(`${A}/venues/${venueId}/today?date=${day}`).expect(200)).body.shows.find((s: any) => s.id === screening.id);
    expect(after.held).toBe(show.held + 2);
    expect(after.capacity).toBe(show.capacity);
  });

  it('refuses a cinema from another operator', async () => {
    const kestrel = (await api(app).get('/v1/t/kestrel/venues').expect(200)).body as any[];
    await api(app, admin).get(`${A}/venues/${kestrel[0].id}/today`).expect(404);
  });

  it('adds a person with a temporary password, changes their role and removes them', async () => {
    const added = (await api(app, admin).post(`${A}/team`, { name: 'Sam Usher', email: 'Sam.Usher@northlight.example', role: 'VENUE_MANAGER' }).expect(201)).body;
    expect(added.member).toMatchObject({ email: 'sam.usher@northlight.example', role: 'VENUE_MANAGER' });
    expect(added.temporaryPassword.length).toBeGreaterThanOrEqual(10);
    const signedIn = (await login('sam.usher@northlight.example', added.temporaryPassword).expect(200)).body;
    expect(signedIn.user.role).toBe('VENUE_MANAGER');

    await api(app, admin).post(`${A}/team`, { name: 'Again', email: 'sam.usher@northlight.example', role: 'REPORTING' }).expect(422);
    await api(app, editor).post(`${A}/team`, { name: 'X', email: 'x@northlight.example', role: 'REPORTING' }).expect(403);

    const team = (await api(app, editor).get(`${A}/team`).expect(200)).body as any[];
    expect(team.map((m) => m.email)).toContain('sam.usher@northlight.example');
    expect(team.every((m) => !('passwordHash' in m))).toBe(true);

    expect((await api(app, admin).put(`${A}/team/${added.member.id}`, { role: 'REPORTING' }).expect(200)).body.role).toBe('REPORTING');
    await api(app, admin).put(`${A}/team/${added.member.id}`, { role: 'PLATFORM_ADMIN' }).expect(422);
    await api(app, admin).del(`${A}/team/${added.member.id}`).expect(204);
    await login('sam.usher@northlight.example', added.temporaryPassword).expect(401);
  });

  it('never removes or demotes yourself or the last operator admin', async () => {
    const team = (await api(app, admin).get(`${A}/team`).expect(200)).body as any[];
    const me = team.find((m) => m.email === 'admin@northlight.example');
    await api(app, admin).del(`${A}/team/${me.id}`).expect(422);
    await api(app, admin).put(`${A}/team/${me.id}`, { role: 'REPORTING' }).expect(422);
    const kestrelAdmin = await app.get(PrismaService).adminUser.findFirstOrThrow({ where: { email: 'admin@kestrel.example' } });
    await api(app, admin).del(`${A}/team/${kestrelAdmin.id}`).expect(404);
  });

  it('saves Parents Guide advice for a film and serves it with a BBFC link', async () => {
    const films = (await api(app, admin).get(`${A}/films`).expect(200)).body as any[];
    const film = films.find((f) => !f.hidden) ?? films[0];
    const saved = (await api(app, editor).put(`${A}/films/${film.id}/content-advice`, { items: [{ category: 'Violence', level: 'Moderate', text: '' }, { category: 'Language', level: 'Strong', text: 'strong language' }] }).expect(200)).body;
    expect(saved.contentAdvice).toMatchObject({ source: 'operator', items: [{ category: 'Violence', level: 'Moderate', text: 'moderate violence' }, { category: 'Language', level: 'Strong' }] });
    expect(saved.contentAdvice.moreInfoUrl).toMatch(/^https:\/\/www\.bbfc\.co\.uk\/search\?q=/);
    const pub = (await api(app).get(`${T}/films/${film.id}`).expect(200)).body;
    expect(pub.contentAdvice.items).toHaveLength(2);
    await api(app, admin).put(`${A}/films/${film.id}/content-advice`, { items: [{ category: 'Violence', level: 'Extreme', text: '' }] }).expect(422);
    await api(app, admin).put(`${A}/films/${film.id}/content-advice`, { items: [] }).expect(200);
  });
});
