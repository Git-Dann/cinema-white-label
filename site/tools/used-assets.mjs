// Lists every file under assets/ that the page actually requests, at desktop, tablet and phone widths,
// with and without reduced motion, so the deployed copy of the Taste Skill kit carries only those.
// Usage (from site/): NODE_PATH=$(npm root -g) node tools/used-assets.mjs > tools/used-assets.txt
import { createRequire } from 'module';
import http from 'http';
import fs from 'fs';
import path from 'path';

const { chromium } = createRequire(import.meta.url)('playwright');
const root = process.cwd();
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png', '.woff2': 'font/woff2' };
const seen = new Set();
const srv = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const p = path.join(root, rel);
  fs.readFile(p, (e, d) => {
    if (e) { r.writeHead(404); return r.end(); }
    if (rel.startsWith('assets/')) seen.add(rel);
    r.writeHead(200, { 'content-type': types[path.extname(p)] || 'application/octet-stream' });
    r.end(d);
  });
}).listen(5392);

const b = await chromium.launch();
for (const [w, h] of [[1440, 900], [1024, 768], [820, 1180], [390, 844]]) {
  for (const reduced of ['no-preference', 'reduce']) {
    const pg = await b.newPage({ viewport: { width: w, height: h }, reducedMotion: reduced });
    await pg.goto('http://127.0.0.1:5392/index.html', { waitUntil: 'networkidle' });
    for (let y = 0; y < 12000; y += h / 2) { await pg.evaluate(v => scrollTo(0, v), y); await pg.waitForTimeout(120); }
    await pg.hover('.nav__item').catch(() => {});
    await pg.waitForTimeout(800);
    await pg.close();
  }
}
await b.close();
srv.close();
console.log([...seen].sort().join('\n'));
