import { Film, MediaAsset, Trailer } from '@prisma/client';
import { publicMediaUrl } from '../media/storage';
import { certificateMeaning, readDetails } from './film-details';

export const RENDITION_WIDTHS = [160, 342, 500, 780, 1280, 1600] as const;

export interface ImageRef {
  id: string;
  /** Relative (or CDN-absolute) URL; append &w=<rendition> for a sized rendition. */
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
    url: publicMediaUrl(a.id, a.updatedAt.getTime()),
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
  const logo = pickAsset(film.assets, 'LOGO', now);
  const details = readDetails(film.details);
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
    /** Title artwork (transparent PNG) shown in place of the title when present. */
    logo: imageRef(logo),
    /** Cast in billing order, with a photo and a short biography where known. */
    people: details.cast.map((c) => ({
      id: String(c.id), name: c.name, character: c.character, biography: c.biography, fullBiography: c.fullBiography ?? null,
      birthday: c.birthday ?? null, deathday: c.deathday ?? null, placeOfBirth: c.placeOfBirth ?? null, photo: personPhoto(c.profilePath),
    })),
    crew: details.crew,
    about: details.about,
    /** Parents Guide: the certificate first, then BBFC content advice by category. */
    contentAdvice: { certificate: film.certificate, meaning: certificateMeaning(film.certificate), items: details.advice },
    trailers: (film.trailers ?? []).map((t) => ({ id: t.id, title: t.title, kind: t.kind, url: t.url, durationSeconds: t.durationSeconds })),
    attributions: [...new Set([poster?.attribution, backdrop?.attribution, logo?.attribution].filter((x): x is string => !!x))],
  };
}
export type FilmDto = ReturnType<typeof filmDto>;

/** A cast photo from TMDB's image CDN, shaped like any other image so the apps load it the same way. */
function personPhoto(path: string | null): ImageRef | null {
  if (!path) return null;
  return {
    id: `tmdb-person${path}`,
    url: `https://image.tmdb.org/t/p/w185${path}`,
    width: 185,
    height: 278,
    aspectRatio: 0.665,
    focalPoint: { x: 0.5, y: 0.3 },
    dominantColor: null,
    attribution: 'Image: TMDB',
    renditions: [],
  };
}
