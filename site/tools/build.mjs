// Deploy-time build for the marketing site (Vercel runs it: the root vercel.json buildCommand; the site project builds from the repo root). No dependencies.
//
// The page links about a dozen stylesheets in <head>, and each one blocks the first paint. This joins the
// page's local stylesheets, in their order, into one minified file named by its content hash
// (site.<hash>.css, cached for good by vercel.json), and points the page at it.
//
// The kit's ui.js looks for its own stylesheets (base.css, <fragment>/fragment.css) by href before adding
// them, and would otherwise add them again after the bundle and change the cascade. Those links stay, with
// media="not all": never applied, never blocking the paint, fetched at idle priority. Every other bundled
// link is removed.
//
// It rewrites index.html in place, so it runs on the deploy's copy of the files only. In the repo the
// page keeps its separate stylesheets, which is how it is edited and checked.
//   node tools/build.mjs [dir]     (dir defaults to the site folder)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = join(root, 'index.html');
let html = readFileSync(pagePath, 'utf8');

const head = html.slice(0, html.indexOf('</head>'));
const linkRe = /<link rel="stylesheet" href="([^"]+)"\s*>/g;
const links = [...head.matchAll(linkRe)].filter(m => !/^(https?:)?\/\//.test(m[1]));
if (!links.length) { console.log('build: no local stylesheets in <head>'); process.exit(0); }

// one pass that drops comments and keeps strings exactly as written, then folds whitespace outside them
export function minify(css) {
  let out = '', i = 0;
  while (i < css.length) {
    const c = css[i];
    if (c === '/' && css[i + 1] === '*') { const end = css.indexOf('*/', i + 2); i = end < 0 ? css.length : end + 2; out += ' '; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < css.length && css[j] !== c) j += css[j] === '\\' ? 2 : 1;
      out += '\u0000' + css.slice(i, j + 1) + '\u0001'; i = j + 1; continue;
    }
    out += c; i++;
  }
  // fold whitespace only outside the strings marked above
  return out.split(/(\u0000[^\u0001]*\u0001)/).map(part => part.startsWith('\u0000') ? part.slice(1, -1)
    : part.replace(/\s+/g, ' ').replace(/\s*([{};,])\s*/g, '$1').replace(/;}/g, '}')).join('').trim();
}

const css = links.map(m => `/* ${m[1]} */\n` + readFileSync(join(root, m[1]), 'utf8')).join('\n');
const min = minify(css);
const hash = createHash('sha256').update(min).digest('hex').slice(0, 10);
const name = `site.${hash}.css`;
for (const f of readdirSync(root)) if (/^site\.[0-9a-f]{10}\.css$/.test(f)) unlinkSync(join(root, f));
writeFileSync(join(root, name), min);

// the bundle where the first stylesheet was; the stylesheets ui.js looks up stay as never-matching links
const lookedUp = href => /^assets\/ui\/(base\.css|[^/]+\/fragment\.css)$/.test(href);
let first = true;
html = html.replace(linkRe, (tag, href) => {
  if (!links.some(m => m[1] === href)) return tag;
  const kept = lookedUp(href) ? `<link rel="stylesheet" href="${href}" media="not all">` : '';
  if (!first) return kept;
  first = false;
  return `<link rel="stylesheet" href="${name}">` + (kept ? `\n${kept}` : '');
});
html = html.replace(/\n\n+/g, '\n');
writeFileSync(pagePath, html);
console.log(`build: ${links.length} stylesheets, ${(css.length / 1024).toFixed(0)} KB -> ${name}, ${(min.length / 1024).toFixed(0)} KB`);
