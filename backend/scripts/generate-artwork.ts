/**
 * Generates original development artwork (posters, backdrops, logos) with
 * Playwright + HTML/SVG. Output is committed under shared/fixtures/artwork so
 * the platform works without any commercial media credentials.
 *
 * Usage: NODE_PATH=$(npm root -g) pnpm ts-node --transpile-only scripts/generate-artwork.ts
 */
import { mkdirSync } from 'fs';
import { join } from 'path';
import { FILMS, FixtureFilm } from '../src/fixtures/films';
import { TENANTS } from '../src/fixtures/tenants';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chromium } = require('playwright');

const OUT = join(__dirname, '../../shared/fixtures/artwork');
mkdirSync(OUT, { recursive: true });

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

function ridge(W: number, base: number, amp: number, steps: number, r: () => number): string {
  let d = `M0 ${base}`;
  for (let i = 0; i <= steps; i++) {
    const x = (i / steps) * W;
    const y = base - r() * amp;
    d += ` L${x.toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

function motif(f: FixtureFilm, W: number, H: number): string {
  const r = rng(f.slug);
  const g = f.art.ground;
  const horizon = H * 0.68;
  switch (f.art.motif) {
    case 'mountains':
      return `<path d="${ridge(W, horizon, H * 0.22, 9, r)} L${W} ${H} L0 ${H} Z" fill="${g}" opacity="0.55"/>
              <path d="${ridge(W, horizon + H * 0.08, H * 0.18, 7, r)} L${W} ${H} L0 ${H} Z" fill="${g}"/>`;
    case 'city': {
      let s = '';
      let x = 0;
      while (x < W) {
        const w = W * (0.04 + r() * 0.07);
        const h = H * (0.12 + r() * 0.3);
        s += `<rect x="${x}" y="${H - h - H * 0.1}" width="${w}" height="${h + H * 0.1}" fill="${g}"/>`;
        for (let i = 0; i < 6; i++) {
          if (r() > 0.55) s += `<rect x="${x + r() * (w - 6)}" y="${H - h - H * 0.1 + r() * h}" width="${W * 0.008}" height="${W * 0.008}" fill="${f.art.orb}" opacity="0.7"/>`;
        }
        x += w + W * 0.004;
      }
      return s;
    }
    case 'sea': {
      let s = `<rect x="0" y="${horizon}" width="${W}" height="${H - horizon}" fill="${g}"/>`;
      for (let i = 0; i < 14; i++) {
        const y = horizon + (H - horizon) * (i / 14) + 4;
        s += `<rect x="${W * 0.3 + r() * W * 0.2}" y="${y}" width="${W * (0.1 + r() * 0.3) * (1 - i / 20)}" height="${H * 0.004}" fill="${f.art.orb}" opacity="${0.5 - i * 0.03}"/>`;
      }
      return s;
    }
    case 'forest': {
      let s = `<rect x="0" y="${H * 0.82}" width="${W}" height="${H * 0.18}" fill="${g}"/>`;
      for (let i = 0; i < 22; i++) {
        const x = r() * W;
        const h = H * (0.18 + r() * 0.28);
        const w = h * 0.32;
        const base = H * 0.86;
        s += `<path d="M${x} ${base - h} L${x + w / 2} ${base} L${x - w / 2} ${base} Z" fill="${g}" opacity="${0.6 + r() * 0.4}"/>`;
      }
      return s;
    }
    case 'desert':
      return `<path d="M0 ${horizon} Q ${W * 0.3} ${horizon - H * 0.08} ${W * 0.6} ${horizon} T ${W} ${horizon - H * 0.03} L${W} ${H} L0 ${H} Z" fill="${g}" opacity="0.6"/>
              <path d="M0 ${horizon + H * 0.1} Q ${W * 0.5} ${horizon - H * 0.02} ${W} ${horizon + H * 0.08} L${W} ${H} L0 ${H} Z" fill="${g}"/>`;
    case 'planet':
    {
      // Planet rim sits at ~68% of the frame height whatever the aspect ratio.
      const pr = W * 0.85;
      const cy = H * 0.68 + pr;
      return `<circle cx="${W * 0.5}" cy="${cy}" r="${pr}" fill="${g}"/>
              <circle cx="${W * 0.5}" cy="${cy}" r="${pr}" fill="none" stroke="${f.art.orb}" stroke-opacity="0.5" stroke-width="${Math.min(W, H) * 0.006}"/>`;
    }
    case 'lighthouse': {
      const lx = W * 0.62;
      const base = H * 0.8;
      return `<path d="M${lx - W * 0.6} ${base - H * 0.05} L${lx + W * 0.03} ${base - H * 0.28} L${lx + W * 0.6} ${base - H * 0.05} Z" fill="${f.art.orb}" opacity="0.12"/>
              <path d="${ridge(W, base, H * 0.05, 6, r)} L${W} ${H} L0 ${H} Z" fill="${g}"/>
              <path d="M${lx - W * 0.035} ${base} L${lx - W * 0.022} ${base - H * 0.26} L${lx + W * 0.022} ${base - H * 0.26} L${lx + W * 0.035} ${base} Z" fill="${g}"/>
              <rect x="${lx - W * 0.02}" y="${base - H * 0.3}" width="${W * 0.04}" height="${H * 0.035}" fill="${f.art.orb}"/>`;
    }
    case 'road':
      return `<path d="${ridge(W, horizon, H * 0.06, 12, r)} L${W} ${H} L0 ${H} Z" fill="${g}"/>
              <path d="M${W * 0.48} ${horizon} L${W * 0.52} ${horizon} L${W * 0.85} ${H} L${W * 0.15} ${H} Z" fill="#000" opacity="0.5"/>
              <path d="M${W * 0.5} ${horizon} L${W * 0.5} ${H}" stroke="${f.art.orb}" stroke-width="${W * 0.006}" stroke-dasharray="${H * 0.03} ${H * 0.03}" opacity="0.8"/>`;
  }
}

function scene(f: FixtureFilm, W: number, H: number, withTitle: boolean): string {
  const [a, b, c] = f.art.sky;
  const orbY = f.art.titlePosition === 'top' && withTitle ? H * 0.42 : H * 0.3;
  const titleSize = W * (f.title.length > 16 ? 0.105 : 0.14);
  const titleY = f.art.titlePosition === 'top' ? H * 0.16 : H * 0.84;
  const title = withTitle
    ? `<div style="position:absolute;left:6%;right:6%;top:${(titleY / H) * 100}%;transform:translateY(-50%);text-align:center;
         font-family:'${f.art.font}';font-size:${titleSize}px;line-height:0.95;color:${f.art.titleColor};
         text-transform:${['Bebas Neue', 'Oswald', 'Archivo Black', 'Space Grotesk'].includes(f.art.font) ? 'uppercase' : 'none'};
         letter-spacing:${f.art.font === 'Space Grotesk' ? '0.08em' : '0.01em'};font-weight:${f.art.font === 'Space Grotesk' ? 600 : 700};
         text-shadow:0 2px 24px rgba(0,0,0,0.35)">${f.title}</div>
       <div style="position:absolute;left:0;right:0;top:${(titleY / H) * 100 + (f.art.titlePosition === 'top' ? 10 : -10)}%;text-align:center;
         font-family:'Space Grotesk';font-size:${W * 0.028}px;letter-spacing:0.3em;color:${f.art.titleColor};opacity:0.75;text-transform:uppercase">${f.tagline}</div>`
    : '';
  return `<div style="position:relative;width:${W}px;height:${H}px;overflow:hidden;background:linear-gradient(180deg,${a} 0%,${b} 55%,${c} 100%)">
    <svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="position:absolute;inset:0">
      <defs>
        <radialGradient id="glow"><stop offset="0" stop-color="${f.art.orb}" stop-opacity="0.55"/><stop offset="1" stop-color="${f.art.orb}" stop-opacity="0"/></radialGradient>
        <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0.08 0"/></filter>
      </defs>
      <circle cx="${W * 0.5}" cy="${orbY}" r="${Math.min(W, H) * 0.45}" fill="url(#glow)"/>
      <circle cx="${W * 0.5}" cy="${orbY}" r="${Math.min(W, H) * 0.11}" fill="${f.art.orb}"/>
      ${motif(f, W, H)}
      <rect width="${W}" height="${H}" filter="url(#grain)"/>
    </svg>
    ${title}
  </div>`;
}

function page(body: string, background = '#000'): string {
  return `<!doctype html><html><head>
  <link href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Bebas+Neue&family=Cormorant+Garamond:wght@700&family=Oswald:wght@600&family=Playfair+Display:wght@700&family=Space+Grotesk:wght@500;600&display=block" rel="stylesheet">
  <style>html,body{margin:0;padding:0;background:${background}}</style></head><body>${body}</body></html>`;
}

async function main() {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  for (const f of FILMS) {
    await p.setViewportSize({ width: 800, height: 1200 });
    await p.setContent(page(scene(f, 800, 1200, true)), { waitUntil: 'networkidle' });
    await p.evaluate(() => (document as any).fonts.ready);
    await p.screenshot({ path: join(OUT, `${f.slug}-poster.jpg`), type: 'jpeg', quality: 82 });
    await p.setViewportSize({ width: 1600, height: 900 });
    await p.setContent(page(scene(f, 1600, 900, false)), { waitUntil: 'networkidle' });
    await p.screenshot({ path: join(OUT, `${f.slug}-backdrop.jpg`), type: 'jpeg', quality: 80 });
    console.log('art', f.slug);
  }
  for (const t of TENANTS) {
    for (const mode of ['light', 'dark'] as const) {
      const color = mode === 'dark' ? '#FFFFFF' : '#0B1220';
      const accent = t.palette.accent[mode];
      await p.setViewportSize({ width: 900, height: 240 });
      await p.setContent(
        page(`<div style="width:900px;height:240px;display:flex;align-items:center;gap:28px;padding-left:24px;background:transparent">
          <svg width="150" height="150" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="${accent}"/><path d="${t.markPath}" fill="${mode === 'dark' ? '#060B14' : '#FFFFFF'}"/></svg>
          <div style="font-family:'${t.logoFont}';font-size:88px;color:${color};letter-spacing:0.02em">${t.wordmark}</div></div>`, 'transparent'),
        { waitUntil: 'networkidle' },
      );
      await p.evaluate(() => (document as any).fonts.ready);
      await p.screenshot({ path: join(OUT, `${t.slug}-logo-${mode}.png`), omitBackground: true });
    }
    console.log('logo', t.slug);
  }
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
