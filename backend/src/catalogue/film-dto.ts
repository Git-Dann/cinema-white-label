import { Film, MediaAsset, Trailer } from '@prisma/client';

export const RENDITION_WIDTHS = [160, 342, 500, 780, 1280, 1600] as const;

export interface ImageRef {
  id: string;
  /** Relative URL; append ?w=<rendition> to request a sized rendition. */
  url: string;
  width: number;
  height: number;
  aspectRatio: number;
  focalPoint: { x: number; y: number };
  dominantColor: string | null;
  attribution: string | null;
  renditions: number[];
}

export function imageRef(a: MediaAsset | undefined | null): ImageRef | null {
  if (!a) return null;
  return {
    id: a.id,
    url: `/v1/media/${a.id}?v=${a.updatedAt.getTime()}`,
    width: a.width,
    height: a.height,
    aspectRatio: Math.round((a.width / a.height) * 1000) / 1000,
    focalPoint: { x: a.focalX, y: a.focalY },
    dominantColor: a.dominantColor,
    attribution: a.attribution,
    renditions: RENDITION_WIDTHS.filter((w) => w <= a.width),
  };
}

/** Picks the preferred, unexpired asset of a kind. Expired assets are never served. */
export function pickAsset(assets: MediaAsset[], kind: MediaAsset['kind'], now: Date): MediaAsset | undefined {
  const usable = assets.filter((a) => a.kind === kind && (!a.expiresAt || a.expiresAt > now));
  return usable.find((a) => a.isPreferred) ?? usable[0];
}

export type FilmStatus = 'nowShowing' | 'comingSoon';

export function filmStatus(film: Pick<Film, 'releaseDate'>, now: Date): FilmStatus {
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  return film.releaseDate <= today ? 'nowShowing' : 'comingSoon';
}

export function filmDto(film: Film & { assets: MediaAsset[]; trailers?: Trailer[] }, now: Date, formats: string[] = []) {
  const poster = pickAsset(film.assets, 'POSTER', now);
  const backdrop = pickAsset(film.assets, 'BACKDROP', now);
  return {
    id: film.id,
    slug: film.slug,
    title: film.title,
    tagline: film.tagline,
    synopsis: film.synopsis,
    releaseDate: film.releaseDate.toISOString().slice(0, 10),
    runtimeMinutes: film.runtimeMinutes,
    certificate: film.certificate,
    genres: film.genres,
    director: film.director,
    cast: film.cast,
    status: filmStatus(film, now),
    formats,
    poster: imageRef(poster),
    backdrop: imageRef(backdrop),
    trailers: (film.trailers ?? []).map((t) => ({ id: t.id, title: t.title, kind: t.kind, url: t.url, durationSeconds: t.durationSeconds })),
    attributions: [...new Set([poster?.attribution, backdrop?.attribution].filter((x): x is string => !!x))],
  };
}
export type FilmDto = ReturnType<typeof filmDto>;
