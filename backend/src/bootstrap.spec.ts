import { corsOrigins } from './bootstrap';

function allowed(setting: string | undefined, origin: string): boolean {
  let result = false;
  corsOrigins(setting)(origin, (_e, ok) => (result = !!ok));
  return result;
}

describe('portal CORS origins', () => {
  it('matches exact origins and https subdomain wildcards', () => {
    expect(allowed('http://localhost:3001', 'http://localhost:3001')).toBe(true);
    expect(allowed('*.vercel.app', 'https://cinema-admin-xyz.vercel.app')).toBe(true);
    expect(allowed('*.vercel.app', 'http://cinema-admin-xyz.vercel.app')).toBe(false);
    expect(allowed('*.vercel.app', 'https://evil.example.com')).toBe(false);
    expect(allowed('*.vercel.app', 'https://vercel.app.evil.com')).toBe(false);
  });

  it('ignores quotes, spaces and trailing slashes pasted into the setting', () => {
    expect(allowed('"*.vercel.app"', 'https://cinema-white-label-vqnk.vercel.app')).toBe(true);
    expect(allowed(" '*.vercel.app' , http://localhost:3001/ ", 'http://localhost:3001')).toBe(true);
    expect(allowed('https://*.vercel.app', 'https://cinema-white-label-vqnk.vercel.app')).toBe(true);
  });
});
