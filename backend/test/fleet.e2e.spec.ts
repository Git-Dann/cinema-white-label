import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { compareVersions } from '@cinema/contracts';
import { FLEET_BRANDS, FLEET_POLICY } from '../src/fleet/fleet.data';
import { createApp } from './harness';

describe('fleet: app update status (integration)', () => {
  let app: INestApplication;
  beforeAll(async () => {
    app = await createApp();
  });
  afterAll(async () => app.close());

  const status = (tenant: string, q: string) => request(app.getHttpServer()).get(`/v1/t/${tenant}/app-status?${q}`);

  it('answers every app in the fleet from the shared policy', async () => {
    const { latestVersion, minimumVersion } = FLEET_POLICY.ios;
    for (const b of FLEET_BRANDS) {
      const r = await status(b.slug, `platform=ios&version=${latestVersion}`).expect(200);
      expect(r.body).toMatchObject({ status: 'current', latestVersion, minimumVersion, message: null });
      expect(r.headers['cache-control']).toContain('max-age=300');
    }
  });

  it('asks apps below the minimum to update, and lets newer builds through', async () => {
    const { minimumVersion } = FLEET_POLICY.ios;
    const older = compareVersions(minimumVersion, '0.0.1') > 0 ? '0.0.1' : null;
    if (older) expect((await status('northlight', `platform=ios&version=${older}`).expect(200)).body.status).toBe('update-required');
    expect((await status('northlight', 'platform=ios&version=99.0.0').expect(200)).body.status).toBe('current');
  });

  it('rejects requests it cannot judge', async () => {
    await status('northlight', 'platform=android&version=1.0.0').expect(400);
    await status('northlight', 'platform=ios&version=latest').expect(400);
    await status('no-such-cinema', 'platform=ios&version=1.0.0').expect(404);
  });
});
