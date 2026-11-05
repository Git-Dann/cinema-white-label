/**
 * Generates original food and drink artwork for the demo menu (one image per
 * fixture SKU) with Playwright + SVG. Output is committed under
 * shared/fixtures/artwork/food so the platform has product images without any
 * stock-photo licences. Operators replace them by uploading their own.
 *
 * Usage: NODE_PATH=$(npm root -g) pnpm ts-node --transpile-only scripts/generate-food-artwork.ts
 */
import { mkdirSync } from 'fs';
import { join } from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { chromium } = require('playwright');

export const FOOD_ART_SIZE = { width: 1200, height: 900 };
const OUT = join(__dirname, '../../shared/fixtures/artwork/food');
const W = FOOD_ART_SIZE.width;
const H = FOOD_ART_SIZE.height;

type Scene = { bg: [string, string]; glow: string; art: string };

function rng(seed: string) {
  let h = 2166136261;
  for (const c of seed) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

/** Kernel cluster: overlapping puffs with a highlight, piled in a dome. */
function popcorn(cx: number, top: number, width: number, seed: string, colours: string[]): string {
  const r = rng(seed);
  let out = '';
  for (let i = 0; i < 70; i++) {
    const t = r();
    const x = cx + (r() - 0.5) * width * (1 - t * 0.35);
    const y = top + 120 - Math.sin(((x - cx) / width + 0.5) * Math.PI) * 110 * (0.55 + r() * 0.45) + t * 40;
    const s = 22 + r() * 16;
    const c = colours[Math.floor(r() * colours.length)];
    out += `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${(r() * 360).toFixed(0)})">
      <circle r="${s}" fill="${c}"/><circle cx="${s * 0.55}" cy="${-s * 0.2}" r="${s * 0.75}" fill="${c}"/>
      <circle cx="${-s * 0.4}" cy="${s * 0.45}" r="${s * 0.7}" fill="${c}"/>
      <circle cx="${-s * 0.25}" cy="${-s * 0.35}" r="${s * 0.32}" fill="#fff" opacity="0.35"/></g>`;
  }
  return out;
}

function bucket(cx: number, base: number, w: number, h: number, seed: string, kernels: string[], stripe = '#C8372D'): string {
  const topW = w;
  const botW = w * 0.72;
  const top = base - h;
  const stripes = Array.from({ length: 7 }, (_, i) => {
    const f0 = i / 7;
    const f1 = (i + 0.5) / 7;
    const x = (f: number, y: number) => {
      const k = (y - top) / h;
      const half = (topW + (botW - topW) * k) / 2;
      return cx - half + f * half * 2;
    };
    return `<path d="M${x(f0, top)} ${top} L${x(f1, top)} ${top} L${x(f1, base)} ${base} L${x(f0, base)} ${base}Z" fill="${stripe}"/>`;
  }).join('');
  return `
    <ellipse cx="${cx}" cy="${base + 8}" rx="${botW * 0.62}" ry="22" fill="#000" opacity="0.35"/>
    ${popcorn(cx, top - 120, topW * 0.95, seed, kernels)}
    <path d="M${cx - topW / 2} ${top} L${cx + topW / 2} ${top} L${cx + botW / 2} ${base} L${cx - botW / 2} ${base}Z" fill="#F6EFE3"/>
    ${stripes}
    <path d="M${cx - topW / 2} ${top} L${cx + topW / 2} ${top} L${cx + botW / 2} ${base} L${cx - botW / 2} ${base}Z" fill="url(#shade)"/>
    <rect x="${cx - topW / 2 - 8}" y="${top - 14}" width="${topW + 16}" height="28" rx="10" fill="#FBF6EC"/>
    <circle cx="${cx}" cy="${top + h * 0.45}" r="${w * 0.16}" fill="#FBF6EC"/>
    <text x="${cx}" y="${top + h * 0.45 + 14}" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="${w * 0.1}" fill="${stripe}">N</text>`;
}

function cup(cx: number, base: number, w: number, h: number, body: string, band: string, straw = '#F2F2F2'): string {
  const top = base - h;
  const botW = w * 0.74;
  return `
    <ellipse cx="${cx}" cy="${base + 8}" rx="${botW * 0.62}" ry="18" fill="#000" opacity="0.35"/>
    <rect x="${cx + w * 0.08}" y="${top - h * 0.42}" width="${w * 0.07}" height="${h * 0.55}" rx="${w * 0.035}" fill="${straw}" transform="rotate(8 ${cx} ${top})"/>
    <path d="M${cx - w / 2} ${top} L${cx + w / 2} ${top} L${cx + botW / 2} ${base} L${cx - botW / 2} ${base}Z" fill="${body}"/>
    <path d="M${cx - w * 0.47} ${top + h * 0.34} L${cx + w * 0.47} ${top + h * 0.34} L${cx + w * 0.44} ${top + h * 0.58} L${cx - w * 0.44} ${top + h * 0.58}Z" fill="${band}"/>
    <path d="M${cx - w / 2} ${top} L${cx + w / 2} ${top} L${cx + botW / 2} ${base} L${cx - botW / 2} ${base}Z" fill="url(#shade)"/>
    <rect x="${cx - w / 2 - 10}" y="${top - 22}" width="${w + 20}" height="30" rx="12" fill="#F4F4F6"/>
    <ellipse cx="${cx}" cy="${top - 22}" rx="${w * 0.36}" ry="12" fill="#E4E4E8"/>
    ${[0.2, 0.35, 0.7, 0.55, 0.82].map((f, i) => `<ellipse cx="${cx - w * 0.38 + f * w * 0.76}" cy="${top + h * (0.68 + (i % 2) * 0.12)}" rx="5" ry="8" fill="#fff" opacity="0.35"/>`).join('')}`;
}

const scenes: Record<string, Scene> = {
  'POP-SWEET': { bg: ['#3B1F12', '#140A06'], glow: '#F2A33A', art: bucket(600, 760, 380, 400, 'sweet', ['#E9B866', '#D99A3E', '#F3CF8A', '#C98430']) },
  'POP-SALT': { bg: ['#2A2622', '#0F0E0C'], glow: '#F6E7C8', art: bucket(600, 760, 380, 400, 'salt', ['#FFF6E2', '#F7E9C8', '#FFFDF5', '#EEDDB6']) },
  'POP-MIX': { bg: ['#36261A', '#120C08'], glow: '#F5C26B', art: bucket(600, 760, 380, 400, 'mix', ['#FFF6E2', '#E9B866', '#F7E9C8', '#D99A3E']) },
  DRINK: { bg: ['#3A0F12', '#120506'], glow: '#FF5A4E', art: cup(600, 770, 300, 430, '#D7262E', '#F4F4F6') },
  WATER: {
    bg: ['#0F2A36', '#050E13'],
    glow: '#7FD3F2',
    art: `
      <ellipse cx="600" cy="780" rx="120" ry="18" fill="#000" opacity="0.35"/>
      <rect x="560" y="250" width="80" height="60" rx="12" fill="#1C7FB0"/>
      <path d="M548 320 Q548 300 570 300 L630 300 Q652 300 652 320 L700 400 Q712 420 712 450 L712 740 Q712 772 680 772 L520 772 Q488 772 488 740 L488 450 Q488 420 500 400Z" fill="#BFE6F5" opacity="0.55"/>
      <path d="M492 520 L708 520 L708 640 L492 640Z" fill="#1C7FB0"/>
      <text x="600" y="595" text-anchor="middle" font-family="Helvetica, Arial" font-weight="700" font-size="44" fill="#fff" letter-spacing="4">STILL</text>
      <path d="M520 460 L520 740" stroke="#fff" stroke-width="14" stroke-linecap="round" opacity="0.35"/>
      <path d="M492 690 L708 690 L708 740 Q708 772 680 772 L520 772 Q492 772 492 740Z" fill="#7FC9E8" opacity="0.5"/>`,
  },
  NACHOS: {
    bg: ['#3A2A0E', '#120D04'],
    glow: '#F7C843',
    art: (() => {
      const r = rng('nachos');
      let chips = '';
      for (let i = 0; i < 26; i++) {
        const x = 440 + r() * 320;
        const y = 480 + r() * 150 - Math.sin(((x - 440) / 320) * Math.PI) * 90;
        chips += `<path d="M0 -70 L62 40 L-62 40Z" fill="${['#F2C14E', '#E8AE33', '#F7D376'][i % 3]}" stroke="#C8901F" stroke-width="3" transform="translate(${x.toFixed(0)} ${y.toFixed(0)}) rotate(${(r() * 360).toFixed(0)})"/>`;
      }
      return `
        <ellipse cx="600" cy="770" rx="290" ry="26" fill="#000" opacity="0.35"/>
        ${chips}
        <path d="M470 560 Q520 520 560 575 Q600 540 640 580 Q690 530 735 575 Q720 640 700 610 Q680 660 650 620 Q620 680 590 625 Q560 670 530 615 Q500 650 470 560Z" fill="#FFB31F"/>
        ${[520, 600, 680].map((x, i) => `<circle cx="${x}" cy="${560 + (i % 2) * 20}" r="12" fill="#3E8E3E"/>`).join('')}
        <path d="M330 640 L870 640 L820 760 L380 760Z" fill="#1F1F22"/>
        <path d="M330 640 L870 640 L860 664 L340 664Z" fill="#2C2C30"/>`;
    })(),
  },
  HOTDOG: {
    bg: ['#3A160E', '#120604'],
    glow: '#FF8A3D',
    art: `
      <ellipse cx="600" cy="740" rx="300" ry="28" fill="#000" opacity="0.35"/>
      <path d="M300 600 Q300 690 400 700 L800 700 Q900 690 900 600Z" fill="#D9934B"/>
      <rect x="280" y="545" width="640" height="70" rx="35" fill="#B5462B"/>
      <rect x="300" y="555" width="600" height="18" rx="9" fill="#D2664A" opacity="0.7"/>
      <path d="M330 575 q20 -30 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0" fill="none" stroke="#F4C21B" stroke-width="12" stroke-linecap="round"/>
      <path d="M300 600 Q300 520 400 515 L800 515 Q900 520 900 600 Q860 560 800 560 L400 560 Q340 560 300 600Z" fill="#E8A65E"/>
      <path d="M380 528 Q600 505 820 528" stroke="#F5C78E" stroke-width="10" fill="none" stroke-linecap="round" opacity="0.7"/>`,
  },
  CHOC: {
    bg: ['#2E1A12', '#0F0806'],
    glow: '#E2A06B',
    art: (() => {
      const r = rng('choc');
      let b = '';
      for (let i = 0; i < 9; i++) {
        const x = 360 + r() * 480;
        const y = 690 + r() * 60;
        b += `<g transform="translate(${x.toFixed(0)} ${y.toFixed(0)})"><ellipse rx="38" ry="16" fill="#4A2A1A"/><ellipse rx="30" ry="11" cy="-3" fill="#6B3E26"/></g>`;
      }
      return `
        <ellipse cx="600" cy="770" rx="250" ry="24" fill="#000" opacity="0.35"/>
        <path d="M470 280 L730 280 L760 700 Q600 730 440 700Z" fill="#6B3E26"/>
        <path d="M462 280 L738 280 L742 320 L458 320Z" fill="#8A5634"/>
        <path d="M455 400 L745 400 L752 560 L448 560Z" fill="#E9C46A"/>
        <text x="600" y="475" text-anchor="middle" font-family="Georgia, serif" font-style="italic" font-weight="700" font-size="54" fill="#4A2A1A">Buttons</text>
        <text x="600" y="525" text-anchor="middle" font-family="Helvetica, Arial" font-size="24" fill="#6B3E26" letter-spacing="6">MILK CHOCOLATE</text>
        ${b}`;
    })(),
  },
  ICECREAM: {
    bg: ['#2B2433', '#0D0B10'],
    glow: '#F4D9B0',
    art: `
      <ellipse cx="600" cy="770" rx="200" ry="22" fill="#000" opacity="0.35"/>
      <path d="M440 520 Q440 380 600 380 Q760 380 760 520Z" fill="#FFF4DD"/>
      <circle cx="520" cy="470" r="14" fill="#fff" opacity="0.7"/>
      ${[470, 530, 600, 670, 730].map((x, i) => `<circle cx="${x}" cy="${515 + (i % 2) * 6}" r="26" fill="#FFF4DD"/>`).join('')}
      <path d="M430 530 L770 530 L740 760 L460 760Z" fill="#F0E2C8"/>
      <path d="M430 530 L770 530 L765 570 L435 570Z" fill="#C9A26A"/>
      <path d="M445 620 L755 620 L745 700 L455 700Z" fill="#C9A26A" opacity="0.35"/>
      <text x="600" y="672" text-anchor="middle" font-family="Georgia, serif" font-weight="700" font-size="40" fill="#7A5A2E">Vanilla</text>
      <rect x="690" y="330" width="22" height="200" rx="11" fill="#D9D9DE" transform="rotate(28 700 430)"/>
      <ellipse cx="760" cy="325" rx="34" ry="22" fill="#D9D9DE" transform="rotate(28 760 325)"/>`,
  },
  'COMBO-DUO': {
    bg: ['#3A1A14', '#120705'],
    glow: '#F2A33A',
    art: `${cup(355, 790, 220, 320, '#D7262E', '#F4F4F6')}${cup(845, 790, 220, 320, '#1C7FB0', '#F4F4F6')}${bucket(600, 790, 340, 360, 'combo', ['#E9B866', '#FFF6E2', '#F3CF8A', '#F7E9C8'])}`,
  },
};

function page(s: Scene): string {
  return `<!doctype html><html><body style="margin:0">
  <svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <defs>
      <radialGradient id="bg" cx="50%" cy="38%" r="75%"><stop offset="0" stop-color="${s.bg[0]}"/><stop offset="1" stop-color="${s.bg[1]}"/></radialGradient>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="${s.glow}" stop-opacity="0.38"/><stop offset="1" stop-color="${s.glow}" stop-opacity="0"/></radialGradient>
      <linearGradient id="shade" x1="0" x2="1"><stop offset="0" stop-color="#000" stop-opacity="0.22"/><stop offset="0.35" stop-color="#fff" stop-opacity="0.12"/><stop offset="0.6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.3"/></linearGradient>
      <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.05 0"/></filter>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
    <ellipse cx="600" cy="500" rx="520" ry="400" fill="url(#glow)"/>
    <rect y="830" width="${W}" height="${H - 830}" fill="#000" opacity="0.18"/>
    <g transform="translate(600 560) scale(1.35) translate(-600 -560)">${s.art}</g>
    <rect width="${W}" height="${H}" filter="url(#grain)"/>
  </svg></body></html>`;
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const p = await browser.newPage({ viewport: { width: W, height: H } });
  for (const [sku, scene] of Object.entries(scenes)) {
    await p.setContent(page(scene));
    await p.screenshot({ path: join(OUT, `${sku.toLowerCase()}.jpg`), type: 'jpeg', quality: 86, clip: { x: 0, y: 0, width: W, height: H } });
    console.log('wrote', sku);
  }
  await browser.close();
}

if (require.main === module) main();
