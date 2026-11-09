import { Injectable } from '@nestjs/common';
import { Clock } from '../common/clock';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { filmDto, filmStatus, FilmStatus } from './film-dto';

@Injectable()
export class FilmsService {
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock) {}

  /** Distinct formats of upcoming screenings per film, used for badges like IMAX. */
  private async formatsByFilm(tenantId: string, filmIds: string[]): Promise<Map<string, string[]>> {
    const rows = await this.prisma.screening.findMany({
      where: { tenantId, filmId: { in: filmIds }, startsAt: { gt: this.clock.now() }, status: 'SCHEDULED' },
      select: { filmId: true, formats: true },
      distinct: ['filmId', 'formats'],
    });
    const map = new Map<string, Set<string>>();
    for (const r of rows) {
      const s = map.get(r.filmId) ?? new Set<string>();
      r.formats.forEach((f) => s.add(f));
      map.set(r.filmId, s);
    }
    return new Map([...map].map(([k, v]) => [k, [...v].sort()]));
  }

  async list(tenantId: string, opts: { status?: FilmStatus; q?: string }) {
    const now = this.clock.now();
    const films = await this.prisma.film.findMany({
      where: {
        tenantId,
        hidden: false,
        ...(opts.q ? { OR: [{ title: { contains: opts.q, mode: 'insensitive' } }, { cast: { has: opts.q } }, { director: { contains: opts.q, mode: 'insensitive' } }] } : {}),
      },
      include: { assets: true },
      orderBy: [{ releaseDate: 'desc' }, { title: 'asc' }],
    });
    const filtered = opts.status ? films.filter((f) => filmStatus(f, now) === opts.status) : films;
    if (opts.status === 'comingSoon') filtered.sort((a, b) => a.releaseDate.getTime() - b.releaseDate.getTime());
    const formats = await this.formatsByFilm(tenantId, filtered.map((f) => f.id));
    return filtered.map((f) => filmDto(f, now, formats.get(f.id)));
  }

  async get(tenantId: string, filmId: string) {
    const film = await this.prisma.film.findFirst({
      where: { tenantId, OR: [{ id: filmId }, { slug: filmId }] },
      include: { assets: true, trailers: { orderBy: { sortOrder: 'asc' } } },
    });
    if (!film) throw Errors.notFound('Film');
    const formats = await this.formatsByFilm(tenantId, [film.id]);
    return filmDto(film, this.clock.now(), formats.get(film.id));
  }
}
