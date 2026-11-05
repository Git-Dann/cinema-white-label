/**
 * Writes a small offline catalogue (films + downsized artwork) into
 * CinemaCore's PreviewData for SwiftUI previews and `-mock-data` app launches.
 * Usage: pnpm ts-node --transpile-only scripts/write-mock-catalogue.ts
 */
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import sharp from 'sharp';
import { FILMS } from '../src/fixtures/films';

const ART = join(__dirname, '../../shared/fixtures/artwork');
const OUT = join(__dirname, '../../ios/Packages/CinemaKit/Sources/CinemaCore/PreviewData');
const SLUGS = ['ember-protocol', 'the-lantern-keeper', 'signal-lost', 'northbound', 'paper-comets', 'velvet-static', 'saltmarsh', 'the-last-cartographer'];

async function asset(slug: string, kind: 'poster' | 'backdrop') {
  const width = kind === 'poster' ? 500 : 960;
  const file = `${slug}-${kind}.jpg`;
  const out = await sharp(join(ART, file)).resize({ width }).jpeg({ quality: 78, mozjpeg: true }).toBuffer();
  writeFileSync(join(OUT, 'artwork', file), out);
  const meta = await sharp(out).metadata();
  const { dominant: d } = await sharp(out).stats();
  return {
    id: `${slug}-${kind}`, url: `artwork/${file}`, width: meta.width!, height: meta.height!,
    aspectRatio: Math.round((meta.width! / meta.height!) * 1000) / 1000, focalPoint: { x: 0.5, y: kind === 'poster' ? 0.5 : 0.4 },
    dominantColor: `#${[d.r, d.g, d.b].map((x) => x.toString(16).padStart(2, '0')).join('')}`.toUpperCase(),
    attribution: null, renditions: [width],
  };
}

async function main() {
  mkdirSync(join(OUT, 'artwork'), { recursive: true });
  const today = new Date('2026-11-05T00:00:00Z');
  const films = [];
  for (const slug of SLUGS) {
    const f = FILMS.find((x) => x.slug === slug)!;
    films.push({
      id: f.slug, slug: f.slug, title: f.title, tagline: f.tagline, synopsis: f.synopsis,
      releaseDate: new Date(today.getTime() + f.releaseOffsetDays * 86400_000).toISOString().slice(0, 10),
      runtimeMinutes: f.runtimeMinutes, certificate: f.certificate, genres: f.genres, director: f.director, cast: f.cast,
      status: f.releaseOffsetDays <= 0 ? 'nowShowing' : 'comingSoon',
      formats: [...new Set(f.formats.flat().filter((x) => !['Audio Described', 'Subtitled', 'Relaxed'].includes(x)))],
      poster: await asset(slug, 'poster'), backdrop: await asset(slug, 'backdrop'),
      trailers: [{ id: `${slug}-trailer`, title: 'Official Trailer', kind: 'trailer', url: null, durationSeconds: 140 }],
      attributions: [],
    });
  }
  writeFileSync(join(OUT, 'mock-films.json'), JSON.stringify(films, null, 2) + '\n');
  console.log(`Wrote ${films.length} films`);
}
main();
