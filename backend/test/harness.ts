import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { randomUUID } from 'crypto';

process.env.DATABASE_URL = process.env.TEST_DATABASE_URL ?? 'postgresql://cinema:cinema@localhost:5432/cinema_test';
process.env.AUTH_SECRET = 'test-secret';

// Imported after env is set so Prisma picks up the test database.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AppModule } = require('../src/app.module');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { configureApp } = require('../src/bootstrap');

export async function createApp(): Promise<INestApplication> {
  const mod = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = mod.createNestApplication({ bodyParser: false, logger: false });
  configureApp(app);
  await app.init();
  app.getHttpServer().setMaxListeners(100);
  return app;
}

export const T = '/v1/t/northlight';

export async function guest(app: INestApplication, tenant = 'northlight'): Promise<string> {
  const r = await request(app.getHttpServer()).post(`/v1/t/${tenant}/auth/guest`).expect(201);
  return r.body.token;
}

export function api(app: INestApplication, token?: string) {
  const server = app.getHttpServer();
  const auth = (r: request.Test) => (token ? r.set('Authorization', `Bearer ${token}`) : r);
  return {
    get: (p: string) => auth(request(server).get(p)),
    post: (p: string, body?: object, key: string | null = randomUUID()) => {
      const r = auth(request(server).post(p));
      if (key) r.set('Idempotency-Key', key);
      return r.send(body ?? {});
    },
    put: (p: string, body?: object) => auth(request(server).put(p)).send(body ?? {}),
    del: (p: string) => auth(request(server).delete(p)),
  };
}

/** Finds a future screening with N contiguous available standard seats in one block. */
export async function findSeats(app: INestApplication, n: number, opts: { format?: string; layout?: string; certificate?: string[] } = {}) {
  const a = api(app);
  const list = (await a.get(`${T}/screenings?days=7`).expect(200)).body as any[];
  for (const s of list) {
    if (opts.format && !s.formats.includes(opts.format)) continue;
    if (opts.certificate && !opts.certificate.includes(s.film.certificate)) continue;
    const det = (await a.get(`${T}/screenings/${s.id}`).expect(200)).body;
    if (opts.layout && !det.layout.name.includes(opts.layout)) continue;
    const av = (await a.get(`${T}/screenings/${s.id}/availability`).expect(200)).body;
    const byRow = new Map<string, any[]>();
    for (const seat of det.layout.seats) byRow.set(seat.rowId, [...(byRow.get(seat.rowId) ?? []), seat]);
    for (const seats of byRow.values()) {
      seats.sort((x, y) => x.order - y.order);
      for (let i = 0; i + n <= seats.length; i++) {
        const run = seats.slice(i, i + n);
        const ok = run.every((x, j) => x.type === 'standard' && !x.restrictedView && av.seats[x.id] === 'available' && (j === 0 || Math.abs(x.x - run[j - 1].x) < x.width * 1.4));
        // Avoid creating orphans so tests aren't affected by warnings.
        if (ok) return { screening: det, seatIds: run.map((x) => x.id) };
      }
    }
  }
  throw new Error('No suitable seats found in fixtures');
}

export function ticketType(det: any, code: string): string {
  const t = det.pricing.ticketTypes.find((x: any) => x.code === code);
  if (!t) throw new Error(`No ticket type ${code}`);
  return t.id;
}
