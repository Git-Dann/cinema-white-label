import { INestApplication } from '@nestjs/common';
import { createHmac } from 'crypto';
import { createServer, IncomingMessage, Server } from 'http';
import { AddressInfo } from 'net';
import request from 'supertest';
import { api, createApp, findSeats, guest, T, ticketType } from './harness';
import { webhookUrlProblem } from '../src/integrations/keys';

interface Received { headers: IncomingMessage['headers']; body: string }

describe('integrations: API keys, partner API, webhooks, shifts (integration)', () => {
  let app: INestApplication;
  let admin: string;
  let editor: string;
  let server: Server;
  let url: string;
  const received: Received[] = [];
  let reply = 200;
  const A = '/v1/admin/t/northlight';
  const partner = (key: string) => ({
    get: (p: string) => request(app.getHttpServer()).get(`/v1/partner${p}`).set('Authorization', `Bearer ${key}`),
    put: (p: string, body: object) => request(app.getHttpServer()).put(`/v1/partner${p}`).set('Authorization', `Bearer ${key}`).send(body),
    del: (p: string) => request(app.getHttpServer()).delete(`/v1/partner${p}`).set('Authorization', `Bearer ${key}`),
  });

  beforeAll(async () => {
    process.env.WEBHOOK_ALLOW_LOCAL = '1';
    app = await createApp();
    const login = (email: string, password: string) => request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email, password }).expect(200);
    admin = (await login('admin@northlight.example', 'operator-dev-password')).body.token;
    editor = (await login('editor@northlight.example', 'editor-dev-password')).body.token;
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        received.push({ headers: req.headers, body });
        res.statusCode = reply;
        res.end('ok');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/hook`;
  });
  afterAll(async () => {
    delete process.env.WEBHOOK_ALLOW_LOCAL;
    server.close();
    await app.close();
  });

  it('issues a scoped key once, keeps only its hash, and enforces scope, revocation and the operator', async () => {
    const created = (await api(app, admin).post(`${A}/api-keys`, { name: 'Warehouse', scopes: ['films:read', 'bookings:read'] }).expect(201)).body;
    expect(created.key).toMatch(/^sf_live_/);
    const listed = (await api(app, admin).get(`${A}/api-keys`).expect(200)).body as any[];
    const row = listed.find((k) => k.id === created.id);
    expect(row).toMatchObject({ prefix: created.key.slice(0, 12), scopes: ['films:read', 'bookings:read'], revokedAt: null });
    expect(JSON.stringify(listed)).not.toContain(created.key);

    const films = (await partner(created.key).get('/films').expect(200)).body as any[];
    expect(films.length).toBeGreaterThan(0);
    expect(films.every((f) => f.title)).toBe(true);
    await partner(created.key).get('/shifts').expect(403);
    await partner('sf_live_not-a-real-key').get('/films').expect(401);
    await request(app.getHttpServer()).get('/v1/partner/films').expect(401);
    expect((await api(app, admin).get(`${A}/api-keys`).expect(200)).body.find((k: any) => k.id === created.id).lastUsedAt).not.toBeNull();

    await api(app, editor).post(`${A}/api-keys`, { name: 'Nope', scopes: ['films:read'] }).expect(403);
    await api(app, admin).post(`${A}/api-keys`, { name: 'Bad', scopes: ['payments:write'] }).expect(422);

    await api(app, admin).del(`${A}/api-keys/${created.id}`).expect(204);
    await partner(created.key).get('/films').expect(401);
    const kestrelAdmin = (await request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email: 'admin@kestrel.example', password: 'operator-dev-password' })).body.token;
    if (kestrelAdmin) await api(app, kestrelAdmin).del(`/v1/admin/t/kestrel/api-keys/${created.id}`).expect(404);
  });

  it('accepts shifts from a rota system idempotently and only for its own cinemas', async () => {
    const key = (await api(app, admin).post(`${A}/api-keys`, { name: 'Rota', scopes: ['shifts:read', 'shifts:write'] }).expect(201)).body.key;
    const venues = (await api(app, admin).get(`${A}/venues`).expect(200)).body as any[];
    const starts = new Date(Date.now() + 86400_000);
    const shift = { externalId: 'pd-1', venueId: venues[0].id, staffName: 'Sam Usher', role: 'Concessions', startsAt: starts.toISOString(), endsAt: new Date(starts.getTime() + 6 * 3600_000).toISOString() };
    await partner(key).put('/shifts', { source: 'Planday', shifts: [shift] }).expect(200);
    await partner(key).put('/shifts', { source: 'planday', shifts: [{ ...shift, role: 'Bar' }] }).expect(200);
    const shifts = (await partner(key).get('/shifts').expect(200)).body as any[];
    expect(shifts.filter((s) => s.externalId === 'pd-1')).toEqual([expect.objectContaining({ source: 'planday', role: 'Bar', staffName: 'Sam Usher' })]);
    expect((await api(app, admin).get(`${A}/shifts?venueId=${venues[0].id}`).expect(200)).body.some((s: any) => s.externalId === 'pd-1')).toBe(true);

    const kestrel = (await api(app).get('/v1/t/kestrel/venues').expect(200)).body as any[];
    await partner(key).put('/shifts', { source: 'planday', shifts: [{ ...shift, externalId: 'x', venueId: kestrel[0].id }] }).expect(422);
    await partner(key).put('/shifts', { source: 'planday', shifts: [{ ...shift, externalId: 'y', endsAt: shift.startsAt }] }).expect(422);
    await partner(key).del('/shifts/planday/pd-1').expect(204);
    await partner(key).del('/shifts/planday/pd-1').expect(404);
  });

  it('refuses webhook URLs that point inside a network', () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(webhookUrlProblem('http://example.com/hook', env)).toMatch(/https/);
    expect(webhookUrlProblem('https://localhost/hook', env)).toMatch(/local/);
    expect(webhookUrlProblem('https://10.0.0.5/hook', env)).toMatch(/private/);
    expect(webhookUrlProblem('https://192.168.1.2/hook', env)).toMatch(/private/);
    expect(webhookUrlProblem('https://user:pw@example.com/hook', env)).toMatch(/password/);
    expect(webhookUrlProblem('https://hooks.example.com/seatfold', env)).toBeNull();
  });

  it('signs booking events without customer details and logs every delivery', async () => {
    const hook = (await api(app, admin).post(`${A}/webhooks`, { url, events: ['booking.confirmed', 'booking.refunded'], description: 'Test receiver' }).expect(201)).body;
    expect(hook.secret).toMatch(/^whsec_/);

    const ping = (await api(app, admin).post(`${A}/webhooks/${hook.id}/test`).expect(201)).body;
    expect(ping).toMatchObject({ status: 'delivered', responseCode: 200 });

    received.length = 0;
    const { screening, seatIds } = await findSeats(app, 1, { minHoursAhead: 3 });
    const t = await guest(app);
    const hold = (await api(app, t).post(`${T}/holds`, { screeningId: screening.id, seatIds }).expect(201)).body;
    const booking = (await api(app, t).post(`${T}/checkout`, { holdId: hold.id, tickets: seatIds.map((seatId) => ({ seatId, ticketTypeId: ticketType(screening, 'ADULT') })), payment: { type: 'simulated' } }).expect(201)).body;

    const confirmed = received.find((r) => r.headers['seatfold-event'] === 'booking.confirmed');
    expect(confirmed).toBeTruthy();
    const [tPart, v1Part] = String(confirmed!.headers['seatfold-signature']).split(',');
    const expected = createHmac('sha256', hook.secret).update(`${tPart.slice(2)}.${confirmed!.body}`).digest('hex');
    expect(v1Part.slice(3)).toBe(expected);
    const event = JSON.parse(confirmed!.body);
    expect(event).toMatchObject({ type: 'booking.confirmed', data: { reference: booking.reference, status: 'CONFIRMED', tickets: 1, screening: { id: screening.id } } });
    expect(confirmed!.body).not.toMatch(/email|customer|phone/i);

    await api(app, t).post(`${T}/bookings/${booking.id}/cancel`, {}).expect((r) => expect([200, 201]).toContain(r.status));
    expect(received.some((r) => r.headers['seatfold-event'] === 'booking.refunded')).toBe(true);

    // A receiver that fails is retried once and logged; it never breaks the booking.
    reply = 500;
    const d = (await api(app, admin).post(`${A}/webhooks/${hook.id}/test`).expect(201)).body;
    expect(d).toMatchObject({ status: 'failed', responseCode: 500 });
    reply = 200;
    const listed = (await api(app, admin).get(`${A}/webhooks`).expect(200)).body.find((h: any) => h.id === hook.id);
    const failed = listed.deliveries.find((x: any) => x.status === 'failed');
    expect(failed.attempts).toBe(2);
    expect(JSON.stringify(listed)).not.toContain(hook.secret);
    expect((await api(app, admin).post(`${A}/webhook-deliveries/${failed.id}/resend`).expect(201)).body.status).toBe('delivered');

    await api(app, admin).post(`${A}/webhooks`, { url: 'ftp://example.com', events: ['booking.confirmed'] }).expect(422);
    await api(app, editor).post(`${A}/webhooks`, { url, events: ['booking.confirmed'] }).expect(403);
    await api(app, admin).del(`${A}/webhooks/${hook.id}`).expect(204);
  });

  it('exports sales for a BI tool without customer details', async () => {
    const key = (await api(app, admin).post(`${A}/api-keys`, { name: 'BI', scopes: ['bookings:read', 'screenings:read'] }).expect(201)).body.key;
    const page = (await partner(key).get('/bookings').expect(200)).body;
    expect(Array.isArray(page.bookings)).toBe(true);
    expect(page.bookings.length).toBeGreaterThan(0);
    expect(page.bookings[0]).toEqual(expect.objectContaining({ reference: expect.any(String), totalMinor: expect.any(Number), currency: 'GBP' }));
    expect(JSON.stringify(page)).not.toMatch(/email|customerId|phone/i);
    const shows = (await partner(key).get('/screenings').expect(200)).body as any[];
    expect(shows[0]).toEqual(expect.objectContaining({ capacity: expect.any(Number), sold: expect.any(Number) }));
    await partner(key).get('/screenings?from=2026-01-01T00:00:00Z&to=2026-12-31T00:00:00Z').expect(422);
  });
});
