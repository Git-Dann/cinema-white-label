import { Prisma, PrismaClient } from '@prisma/client';
import { AuditoriumLayout } from '@cinema/contracts';
import { zonedDate, zonedToUtc } from '../common/time';

/** Daily start times used for generated demo screenings (venue local time). */
export const SHOW_TIMES = ['12:30', '15:20', '18:10', '20:50'];

type Db = Pick<PrismaClient, 'film' | 'auditorium' | 'screening' | 'screeningSeat' | 'booking' | '$executeRaw'>;

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Keeps every auditorium programmed for the next `days` days, so the demo never
 * runs out of showtimes:
 *  1. Future screenings of films that are hidden or not yet released move to a
 *     film that is showing, unless a customer has booked them.
 *  2. Empty slots get a screening of a showing film, with simulated sales from
 *     other channels so seat maps look lived-in.
 * Formats follow the auditorium's last screening (an IMAX screen stays IMAX).
 * Safe to run repeatedly; it only fills gaps.
 */
export async function ensureScreeningHorizon(db: Db, tenantId: string, now: Date, days = 7) {
  const films = await db.film.findMany({
    where: { tenantId, hidden: false, releaseDate: { lte: now } },
    orderBy: [{ releaseDate: 'desc' }, { title: 'asc' }],
    select: { id: true, runtimeMinutes: true },
  });
  if (!films.length) return { created: 0, reassigned: 0 };
  const showing = new Map(films.map((f) => [f.id, f]));

  // 1. Re-point future screenings whose film is no longer showing.
  const stale = await db.screening.findMany({
    where: { tenantId, startsAt: { gt: now }, status: 'SCHEDULED', filmId: { notIn: [...showing.keys()] } },
    select: { id: true, startsAt: true },
    orderBy: { startsAt: 'asc' },
  });
  const booked = new Set(
    (await db.booking.findMany({ where: { screeningId: { in: stale.map((s) => s.id) } }, select: { screeningId: true } })).map((b) => b.screeningId),
  );
  // One UPDATE per 500 rows, not one per screening: the first switch to a new catalogue can
  // move a few hundred screenings, and row-by-row that outran the API's 60-second limit.
  const moves = stale
    .map((s, i) => ({ s, film: films[i % films.length] }))
    .filter(({ s }) => !booked.has(s.id))
    .map(({ s, film }) => Prisma.sql`(${s.id}, ${film.id}, ${new Date(s.startsAt.getTime() + (film.runtimeMinutes + 20) * 60000)}::timestamp(3))`);
  for (let i = 0; i < moves.length; i += 500) {
    await db.$executeRaw`UPDATE "Screening" AS s SET "filmId" = v.film, "endsAt" = v.ends FROM (VALUES ${Prisma.join(moves.slice(i, i + 500))}) AS v(id, film, ends) WHERE s.id = v.id`;
  }
  const reassigned = moves.length;

  // 2. Fill empty slots.
  const auditoriums = await db.auditorium.findMany({
    where: { tenantId },
    include: { venue: true, layouts: { where: { status: 'PUBLISHED' }, orderBy: { version: 'desc' }, take: 1 } },
    orderBy: [{ venueId: 'asc' }, { screenNumber: 'asc' }],
  });
  const random = rng(now.getUTCDate() * 7919 + tenantId.length);
  let created = 0;
  for (const [ai, aud] of auditoriums.entries()) {
    const layout = aud.layouts[0];
    if (!layout) continue;
    const geometry = layout.geometry as unknown as AuditoriumLayout;
    const last = await db.screening.findFirst({ where: { auditoriumId: aud.id }, orderBy: { startsAt: 'desc' }, select: { formats: true, attributes: true } });
    const existing = new Set(
      (await db.screening.findMany({ where: { auditoriumId: aud.id, startsAt: { gt: now } }, select: { startsAt: true } })).map((s) => s.startsAt.getTime()),
    );
    for (let d = 0; d < days; d++) {
      const date = zonedDate(new Date(now.getTime() + d * 86400_000), aud.venue.timeZone);
      for (const [si, time] of SHOW_TIMES.entries()) {
        const startsAt = zonedToUtc(date, time, aud.venue.timeZone);
        if (startsAt <= now || existing.has(startsAt.getTime())) continue;
        const dayIndex = Math.floor(startsAt.getTime() / 86400_000);
        const film = films[(ai * 3 + si + dayIndex) % films.length];
        const screening = await db.screening.create({
          data: {
            tenantId, venueId: aud.venueId, auditoriumId: aud.id, layoutVersionId: layout.id, filmId: film.id, startsAt,
            endsAt: new Date(startsAt.getTime() + (film.runtimeMinutes + 20) * 60000), formats: last?.formats ?? ['2D'], attributes: last?.attributes ?? [],
          },
        });
        const demand = 0.08 + random() * 0.4 * (si >= 2 ? 1.4 : 0.7);
        await db.screeningSeat.createMany({
          data: geometry.seats.map((seat) => {
            const r = random();
            return { screeningId: screening.id, seatId: seat.id, state: r < 0.01 ? 'BLOCKED' : r < demand ? 'SOLD' : 'AVAILABLE' } as Prisma.ScreeningSeatCreateManyInput;
          }),
        });
        existing.add(startsAt.getTime());
        created++;
      }
    }
  }
  return { created, reassigned };
}
