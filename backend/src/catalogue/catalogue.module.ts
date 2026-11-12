import { Controller, Get, Headers, Module, Param, Query, UseGuards } from '@nestjs/common';
import { DEMO_TENANTS, refreshBankHolidays, rollupOutcomes } from '../intelligence/outcomes';
import { ensureDemoInterest, refreshInterest } from '../intelligence/interest';
import { SLOT_BASE } from '../intelligence/pulse';
import { ApiExcludeController, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Tenant } from '@prisma/client';
import { Clock } from '../common/clock';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { CurrentTenant, TenantGuard } from '../common/tenant-context';
import { FilmsService } from './films.service';
import { ensureScreeningHorizon } from './schedule';
import { httpTmdbClient, importTmdbDemoCatalogue, tmdbDemoEnabled } from './tmdb-demo';

@ApiTags('Films')
@Controller('v1/t/:tenant/films')
@UseGuards(TenantGuard)
export class FilmsController {
  constructor(private readonly films: FilmsService) {}

  @Get()
  @ApiQuery({ name: 'status', required: false, enum: ['nowShowing', 'comingSoon'] })
  @ApiQuery({ name: 'q', required: false })
  list(@CurrentTenant() tenant: Tenant, @Query('status') status?: 'nowShowing' | 'comingSoon', @Query('q') q?: string) {
    return this.films.list(tenant.id, { status: status === 'nowShowing' || status === 'comingSoon' ? status : undefined, q: q?.trim() || undefined });
  }

  @Get(':filmId')
  get(@CurrentTenant() tenant: Tenant, @Param('filmId') filmId: string) {
    return this.films.get(tenant.id, filmId);
  }
}

/**
 * Daily housekeeping, called by Vercel Cron with `Authorization: Bearer $CRON_SECRET`:
 * refreshes the TMDB demo catalogue when it is on, and keeps a week of screenings
 * programmed for every operator. Off (404) unless CRON_SECRET is set.
 */
@ApiExcludeController()
@Controller('v1/cron')
export class CronController {
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock) {}

  @Get('daily')
  async daily(@Headers('authorization') auth?: string) {
    const secret = process.env.CRON_SECRET;
    if (!secret) throw Errors.notFound('Route');
    if (auth !== `Bearer ${secret}`) throw Errors.unauthorised();
    const now = this.clock.now();
    const results: Record<string, unknown> = {};
    for (const t of await this.prisma.tenant.findMany({ select: { id: true, slug: true } })) {
      const films = tmdbDemoEnabled() ? await importTmdbDemoCatalogue(this.prisma, t.id, httpTmdbClient(), now) : null;
      results[t.slug] = {
        films,
        screenings: await ensureScreeningHorizon(this.prisma, t.id, now),
        outcomes: await rollupOutcomes(this.prisma, t.id, now),
        // Audience interest from Wikipedia page views (CC0); a failure keeps yesterday's figures.
        interest: await refreshInterest(this.prisma, t.id, now).catch(() => 'unchanged'),
      };
    }
    // Bank holidays for Pulse (gov.uk, Open Government Licence); a failed fetch keeps the cache.
    results.bankHolidays = await refreshBankHolidays(this.prisma).catch(() => 'unchanged');
    results.demoInterest = await ensureDemoInterest(this.prisma, DEMO_TENANTS, SLOT_BASE, now);
    return results;
  }
}

@Module({ controllers: [FilmsController, CronController], providers: [FilmsService], exports: [FilmsService] })
export class CatalogueModule {}
