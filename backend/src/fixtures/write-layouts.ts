/**
 * Writes the fixture layouts to shared/fixtures/layouts so the iOS package
 * tests and SwiftUI previews use exactly the same geometry as the backend.
 * Also renders an SVG preview of each for quick visual inspection.
 */
import { writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { AuditoriumLayout, validateLayout } from '@cinema/contracts';
import { curvedLayout, luxeLayout, premiereLayout, standardLayout } from './layouts';

const outDir = join(__dirname, '../../../shared/fixtures/layouts');
mkdirSync(outDir, { recursive: true });
const previewDir = join(__dirname, '../../../ios/Packages/CinemaKit/Sources/CinemaCore/PreviewData');
mkdirSync(previewDir, { recursive: true });

const layouts: [string, AuditoriumLayout][] = [
  ['standard', standardLayout('layout-standard')],
  ['curved', curvedLayout('layout-curved')],
  ['luxe', luxeLayout('layout-luxe')],
  ['premiere', premiereLayout('layout-premiere')],
];

for (const [name, layout] of layouts) {
  const issues = validateLayout(layout);
  if (issues.length) {
    console.error(name, issues);
    process.exitCode = 1;
  }
  writeFileSync(join(outDir, `${name}.json`), JSON.stringify(layout, null, 2) + '\n');
  // Same JSON bundled into CinemaCore for SwiftUI previews and the mock service.
  writeFileSync(join(previewDir, `${name}.json`), JSON.stringify(layout, null, 2) + '\n');
  writeFileSync(join(outDir, `${name}.preview.svg`), toSvg(layout));
  console.log(`${name}: ${layout.seats.length} seats, ${issues.length} issues`);
}

function toSvg(l: AuditoriumLayout): string {
  const W = 1000;
  const H = W / l.aspectRatio;
  const colour: Record<string, string> = {
    standard: '#3A4660', premium: '#B8892E', recliner: '#6B4FA3', sofa: '#8E3B6B', luxePod: '#2F7D6B', vipBed: '#7A3E9D', wheelchair: '#2F6FD6', companion: '#1E9AA0',
  };
  const s = l.screen;
  const sx0 = (s.center.x - s.width / 2) * W;
  const sx1 = (s.center.x + s.width / 2) * W;
  const sy = s.center.y * W;
  const sag = s.curvature * s.width * W;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`,
    `<rect width="100%" height="100%" fill="#060B14"/>`,
    `<path d="M ${sx0} ${sy} Q ${s.center.x * W} ${sy - sag * 2} ${sx1} ${sy}" stroke="#C5CDDA" stroke-width="4" fill="none"/>`,
    `<text x="${s.center.x * W}" y="${sy + 24}" fill="#8E9AB0" font-family="sans-serif" font-size="16" text-anchor="middle" letter-spacing="6">${s.label}</text>`,
  ];
  for (const f of l.features) {
    parts.push(`<rect x="${f.x * W}" y="${f.y * W}" width="${f.width * W}" height="${f.height * W}" fill="none" stroke="#1F2B42" stroke-dasharray="4 3"/>`);
    if (f.label) parts.push(`<text x="${(f.x + f.width / 2) * W}" y="${(f.y + f.height / 2) * W + 4}" fill="#5B6577" font-size="11" font-family="sans-serif" text-anchor="middle">${f.label}</text>`);
  }
  for (const seat of l.seats) {
    const w = seat.width * W;
    const h = seat.height * W;
    parts.push(
      `<g transform="translate(${seat.x * W} ${seat.y * W}) rotate(${seat.rotation})"><rect x="${-w / 2}" y="${-h / 2}" width="${w}" height="${h}" rx="${h * 0.28}" fill="${colour[seat.type]}"/><text y="4" fill="#fff" font-size="${Math.min(11, h * 0.4)}" font-family="sans-serif" text-anchor="middle">${seat.label}</text></g>`,
    );
  }
  const rowsSeen = new Set<string>();
  for (const seat of l.seats) {
    if (rowsSeen.has(seat.rowId)) continue;
    rowsSeen.add(seat.rowId);
    const rowSeats = l.seats.filter((x) => x.rowId === seat.rowId);
    const left = rowSeats.reduce((a, b) => (a.x < b.x ? a : b));
    parts.push(`<text x="${left.x * W - left.width * W}" y="${left.y * W + 5}" fill="#8E9AB0" font-size="13" font-family="sans-serif" text-anchor="end">${seat.rowId}</text>`);
  }
  parts.push('</svg>');
  return parts.join('\n');
}
