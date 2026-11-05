import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { api, createApp, T } from './harness';
import { PrismaService } from '../src/common/prisma.service';

describe('admin management: seat categories, pricing, food, vouchers, layouts (integration)', () => {
  let app: INestApplication;
  let admin: string;
  let editor: string;
  const A = '/v1/admin/t/northlight';

  beforeAll(async () => {
    app = await createApp();
    const login = (email: string, password: string) => request(app.getHttpServer()).post('/v1/admin/auth/login').send({ email, password }).expect(200);
    admin = (await login('admin@northlight.example', 'operator-dev-password')).body.token;
    editor = (await login('editor@northlight.example', 'editor-dev-password')).body.token;
  });
  afterAll(async () => app.close());
  const prisma = () => app.get(PrismaService);

  describe('seat categories and pricing', () => {
    it('lists categories with the allowed shapes and icons', async () => {
      const r = (await api(app, admin).get(`${A}/seat-categories`).expect(200)).body;
      expect(r.categories.map((c: any) => c.id)).toContain('vip-bed');
      expect(r.icons).toContain('bed.double.fill');
    });

    it('rejects colours that are not legible on the operator themes', async () => {
      const r = await api(app, admin).post(`${A}/seat-categories`, {
        id: 'gold', label: 'Gold', shape: 'seat', icon: 'crown.fill',
        colours: { light: { fill: '#FFFFFF', accent: '#FAFAFA' }, dark: { fill: '#000000', accent: '#0A0A0A' } },
      }, null);
      expect(r.status).toBe(422);
      expect(r.body.error.message).toContain('needs 3:1');
    });

    it('creates a category, prices it, and the price reaches screenings', async () => {
      await api(app, admin).post(`${A}/seat-categories`, {
        id: 'gold', label: 'Gold', description: 'Centre seats with table', shape: 'seat', icon: 'crown.fill',
        colours: { light: { fill: '#F6EBD9', accent: '#8A6A12' }, dark: { fill: '#2A2116', accent: '#F5C451' } },
      }, null).expect(201);
      const pricing = (await api(app, admin).get(`${A}/pricing`).expect(200)).body;
      const adult = pricing.ticketTypes.find((t: any) => t.code === 'ADULT');
      expect(adult.prices.gold).toBeNull();
      const updated = (await api(app, admin).put(`${A}/pricing`, { prices: [{ ticketTypeId: adult.id, priceCategory: 'gold', amountMinor: 1995 }] }).expect(200)).body;
      expect(updated.ticketTypes.find((t: any) => t.code === 'ADULT').prices.gold).toBe(1995);
      // Editors cannot change prices.
      await api(app, editor).put(`${A}/pricing`, { prices: [{ ticketTypeId: adult.id, priceCategory: 'gold', amountMinor: 1 }] }).expect(403);
    });

    it('refuses to delete a category used by a layout', async () => {
      const r = await api(app, admin).del(`${A}/seat-categories/premium`);
      expect(r.status).toBe(422);
      expect(r.body.error.message).toContain('auditorium layout');
    });
  });

  describe('food and drink', () => {
    it('validates modifier groups', async () => {
      const bad = await api(app, admin).post(`${A}/concessions`, {
        sku: 'PRETZEL', name: 'Pretzel', category: 'Snacks', priceMinor: 400,
        modifierGroups: [{ id: 'dip', name: 'Dip', min: 2, max: 1, options: [{ id: 'mustard', name: 'Mustard', priceMinor: 0 }] }],
      }, null);
      expect(bad.status).toBe(422);
    });

    it('creates, updates and serves a product on the customer menu', async () => {
      const p = (await api(app, admin).post(`${A}/concessions`, {
        sku: 'PRETZEL', name: 'Pretzel', category: 'Snacks', priceMinor: 400, allergens: ['Gluten'],
        modifierGroups: [{ id: 'dip', name: 'Dip', min: 0, max: 1, options: [{ id: 'mustard', name: 'Mustard', priceMinor: 50 }] }],
      }, null).expect(201)).body;
      await api(app, admin).put(`${A}/concessions/${p.id}`, { stockStatus: 'low' }).expect(200);
      const leeds = (await api(app).get(`${T}/venues/leeds-riverside`)).body;
      const menu = (await api(app).get(`${T}/venues/${leeds.id}/concessions`)).body;
      const item = menu.categories.find((c: any) => c.name === 'Snacks').items[0];
      expect(item).toMatchObject({ name: 'Pretzel', stockStatus: 'low', priceMinor: 400 });
      await api(app, admin).del(`${A}/concessions/${p.id}`).expect(204);
    });
  });

  describe('vouchers', () => {
    it('creates a voucher, normalises the code, and enforces sensible terms', async () => {
      const v = (await api(app, admin).post(`${A}/vouchers`, { code: 'spring25', description: '25% off', kind: 'percentOff', value: 25 }, null).expect(201)).body;
      expect(v.code).toBe('SPRING25');
      await api(app, admin).post(`${A}/vouchers`, { code: 'BAD', description: 'x', kind: 'percentOff', value: 150 }, null).expect(422);
      await api(app, admin).post(`${A}/vouchers`, { code: 'spring25', description: 'dup', kind: 'amountOff', value: 100 }, null).expect(422);
      const off = (await api(app, admin).put(`${A}/vouchers/${v.id}`, { active: false }).expect(200)).body;
      expect(off.active).toBe(false);
    });
  });

  describe('auditorium layouts', () => {
    const layout = (name: string, seats: { id: string; label: string; x: number; priceCategory?: string }[]) => ({
      id: 'new', version: 1, name, aspectRatio: 1.4,
      screen: { center: { x: 0.5, y: 0.08 }, width: 0.6, curvature: 0.05, edge: 'top', label: 'SCREEN' },
      sections: [{ id: 'stalls', name: 'Stalls', order: 0 }],
      rows: [{ id: 'A', sectionId: 'stalls', label: 'A', order: 0 }],
      seats: seats.map((s, i) => ({ id: s.id, rowId: 'A', sectionId: 'stalls', label: s.label, order: i, x: s.x, y: 0.3, rotation: 0, width: 0.05, height: 0.05, type: 'standard', priceCategory: s.priceCategory ?? 'standard', accessibility: [], companionFor: [], groupId: null, restrictedView: null })),
      features: [],
    });

    it('drafts, validates and publishes a layout without touching existing screenings', async () => {
      const venues = (await api(app, admin).get(`${A}/auditoriums`).expect(200)).body;
      const york = venues.find((v: any) => v.venue.name.includes('York'));
      const aud = (await api(app, admin).post(`${A}/venues/${york.venue.id}/auditoriums`, { name: 'Screen 9', screenNumber: 9 }, null).expect(201)).body;
      await api(app, admin).post(`${A}/venues/${york.venue.id}/auditoriums`, { name: 'Dup', screenNumber: 9 }, null).expect(422);

      // Overlapping seats and an unpriced category are reported, and block publishing.
      const bad = layout('Screen 9', [{ id: 'A-1', label: '1', x: 0.4 }, { id: 'A-2', label: '2', x: 0.401, priceCategory: 'mystery' }]);
      const check = (await api(app, admin).post(`${A}/layouts/validate`, { geometry: bad }, null).expect(200)).body;
      expect(check.ok).toBe(false);
      expect(check.issues.map((i: any) => i.code)).toEqual(expect.arrayContaining(['seat.overlap', 'category.unknown', 'category.unpriced']));

      const draft = (await api(app, admin).post(`${A}/auditoriums/${aud.id}/layouts`, { geometry: bad }, null).expect(201)).body;
      expect(draft.status).toBe('DRAFT');
      await api(app, admin).post(`${A}/auditoriums/${aud.id}/layouts`, { geometry: bad }, null).expect(422); // one draft at a time
      const blocked = await api(app, admin).post(`${A}/layouts/${draft.id}/publish`, {}, null);
      expect(blocked.status).toBe(422);
      expect(blocked.body.error.code).toBe('publish_blocked');

      const good = layout('Screen 9', [{ id: 'A-1', label: '1', x: 0.4 }, { id: 'A-2', label: '2', x: 0.47 }, { id: 'A-3', label: '3', x: 0.54 }]);
      const edited = (await api(app, admin).put(`${A}/layouts/${draft.id}`, { geometry: good }).expect(200)).body;
      expect(edited.issues).toEqual([]);
      await api(app, editor).post(`${A}/layouts/${draft.id}/publish`, {}, null).expect(403);
      const published = (await api(app, admin).post(`${A}/layouts/${draft.id}/publish`, {}, null).expect(200)).body;
      expect(published).toMatchObject({ status: 'PUBLISHED', seatCount: 3, version: 1 });
      await api(app, admin).put(`${A}/layouts/${draft.id}`, { geometry: good }).expect(422); // immutable

      // A second version retires the first for new screenings.
      const v2 = (await api(app, admin).post(`${A}/auditoriums/${aud.id}/layouts`, { geometry: good }, null).expect(201)).body;
      expect(v2.version).toBe(2);
      await api(app, admin).post(`${A}/layouts/${v2.id}/publish`, {}, null).expect(200);
      const after = (await api(app, admin).get(`${A}/auditoriums`)).body.find((v: any) => v.venue.id === york.venue.id).auditoriums.find((x: any) => x.id === aud.id);
      expect(after.versions.map((x: any) => [x.version, x.status])).toEqual([[2, 'PUBLISHED'], [1, 'RETIRED']]);
    });

    it('renames screens and deletes only those without screenings', async () => {
      const venues = (await api(app, admin).get(`${A}/auditoriums`)).body;
      const york = venues.find((v: any) => v.venue.name.includes('York'));
      const aud = (await api(app, admin).post(`${A}/venues/${york.venue.id}/auditoriums`, { name: 'Temp', screenNumber: 12 }, null).expect(201)).body;
      expect((await api(app, admin).put(`${A}/auditoriums/${aud.id}`, { name: 'Screen 12' }).expect(200)).body.name).toBe('Screen 12');
      await api(app, editor).del(`${A}/auditoriums/${aud.id}`).expect(403);
      await api(app, admin).del(`${A}/auditoriums/${aud.id}`).expect(204);
      const busy = york.auditoriums.find((x: any) => x.versions.length > 0 && x.screenNumber === 1);
      const r = await api(app, admin).del(`${A}/auditoriums/${busy.id}`);
      expect(r.status).toBe(422);
      expect(r.body.error.message).toContain('screening');
    });

    it('keeps screenings on the layout version they were created with', async () => {
      const venues = (await api(app, admin).get(`${A}/auditoriums`)).body;
      const audWithScreenings = venues[0].auditoriums[0];
      const current = audWithScreenings.versions.find((v: any) => v.status === 'PUBLISHED');
      const detail = (await api(app, admin).get(`${A}/layouts/${current.id}`).expect(200)).body;
      expect(detail.screenings).toBeGreaterThan(0);
      const geometry = { ...detail.geometry, seats: detail.geometry.seats.slice(0, 20) };
      const draft = (await api(app, admin).post(`${A}/auditoriums/${audWithScreenings.id}/layouts`, { geometry }, null).expect(201)).body;
      await api(app, admin).post(`${A}/layouts/${draft.id}/publish`, {}, null).expect(200);
      const old = (await api(app, admin).get(`${A}/layouts/${current.id}`)).body;
      expect(old.status).toBe('RETIRED');
      expect(old.screenings).toBe(detail.screenings);
      expect(old.geometry.seats.length).toBe(detail.geometry.seats.length);
    });
  });

  it('refuses to delete a category still used only by a retired layout', async () => {
    // The previous test retired a layout version; its categories must stay deletable-protected.
    await api(app, admin).post(`${A}/seat-categories`, { id: 'retired-only', label: 'Retired only', shape: 'seat' }, null).expect(201);
    const venues = (await api(app, admin).get(`${A}/auditoriums`)).body;
    const york = venues.find((v: any) => v.venue.name.includes('York'));
    const aud = (await api(app, admin).post(`${A}/venues/${york.venue.id}/auditoriums`, { name: 'Screen 13', screenNumber: 13 }, null).expect(201)).body;
    const seat = (id: string, x: number, cat: string) => ({ id, rowId: 'A', sectionId: 's', label: id, order: 0, x, y: 0.3, rotation: 0, width: 0.05, height: 0.05, type: 'standard', priceCategory: cat, accessibility: [], companionFor: [], groupId: null, restrictedView: null });
    const geo = (cat: string) => ({ id: 'x', version: 1, name: 'S13', aspectRatio: 1.4, screen: { center: { x: 0.5, y: 0.08 }, width: 0.6, curvature: 0.05, edge: 'top', label: 'SCREEN' },
      sections: [{ id: 's', name: 'Stalls', order: 0 }], rows: [{ id: 'A', sectionId: 's', label: 'A', order: 0 }], seats: [seat('A-1', 0.4, cat)], features: [] });
    // v1 uses the new category, but publishing needs it priced, so draft-only then replace.
    const v1 = (await api(app, admin).post(`${A}/auditoriums/${aud.id}/layouts`, { geometry: geo('retired-only') }, null).expect(201)).body;
    await prisma().auditoriumLayoutVersion.update({ where: { id: v1.id }, data: { status: 'RETIRED' } });
    const r = await api(app, admin).del(`${A}/seat-categories/retired-only`);
    expect(r.status).toBe(422);
  });

  it('isolates tenants', async () => {
    await api(app, admin).get('/v1/admin/t/kestrel/seat-categories').expect(403);
    await api(app, admin).get('/v1/admin/t/kestrel/auditoriums').expect(403);
  });
});
