import { Body, Controller, Get, Module, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { DirectoryEntry, TenantConfig } from '@cinema/contracts';
import { Tenant } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { AdminGuard, CurrentAdmin, CurrentTenant, Roles, TenantCache } from '../common/tenant-context';
import type { AdminClaims } from '../common/tokens';
import { ZodPipe } from '../common/zod.pipe';
import { TenantsModule } from '../tenants/tenants.module';
import { ConfigService } from '../tenants/config.service';
import { distanceKm } from '../venues/venues.module';

const round1 = (n: number) => Math.round(n * 10) / 10;
const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');

/**
 * The shared Seatfold app: one App Store app listing every operator that opts in, with each
 * operator's own theme once chosen (Apple guideline 4.2.6 "picker" model). Public, no tenant.
 */
@ApiTags('Seatfold app')
@Controller('v1/directory')
export class DirectoryController {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  @Get()
  @ApiOperation({ summary: 'Operators listed in the shared Seatfold app, nearest first when a location is given' })
  @ApiQuery({ name: 'q', required: false, description: 'Operator, cinema, town or postcode' })
  @ApiQuery({ name: 'lat', required: false })
  @ApiQuery({ name: 'lng', required: false })
  async list(@Query('q') q?: string, @Query('lat') lat?: string, @Query('lng') lng?: string): Promise<DirectoryEntry[]> {
    const la = Number(lat);
    const lo = Number(lng);
    const hasLoc = lat !== undefined && lng !== undefined && Number.isFinite(la) && Number.isFinite(lo);
    const tenants = await this.prisma.tenant.findMany({ where: { listedInSeatfoldApp: true }, include: { venues: true }, orderBy: { name: 'asc' } });
    const term = q?.trim() ? norm(q) : null;
    const out: DirectoryEntry[] = [];
    for (const t of tenants) {
      if (term && !norm(t.name).includes(term) && !t.venues.some((v) => [v.name, v.city, v.postcode].some((x) => norm(x).includes(term) || term.startsWith(norm(x))))) continue;
      // Only operators that have published their brand can be shown.
      const cfg: TenantConfig | null = await this.config.current(t.id).catch(() => null);
      if (!cfg) continue;
      const venues = t.venues
        .map((v) => ({ name: v.name, city: v.city, distanceKm: hasLoc ? round1(distanceKm(la, lo, v.latitude, v.longitude)) : null }))
        .sort((a, b) => (hasLoc ? (a.distanceKm ?? 0) - (b.distanceKm ?? 0) : a.name.localeCompare(b.name)));
      out.push({
        slug: t.slug,
        name: t.name,
        wordmark: cfg.branding.wordmark,
        logoLightUrl: cfg.branding.logoLightUrl,
        logoDarkUrl: cfg.branding.logoDarkUrl,
        accent: cfg.branding.palette.accent,
        venues,
      });
    }
    if (hasLoc) out.sort((a, b) => (a.venues[0]?.distanceKm ?? Infinity) - (b.venues[0]?.distanceKm ?? Infinity));
    return out;
  }
}

/** Operators choose whether they appear in the shared Seatfold app. */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('v1/admin/t/:tenant/seatfold-app')
@UseGuards(AdminGuard)
export class SeatfoldAppAdminController {
  constructor(private readonly prisma: PrismaService, private readonly tenants: TenantCache) {}

  @Get()
  @ApiOperation({ summary: 'Whether this operator is listed in the shared Seatfold app' })
  get(@CurrentTenant() t: Tenant) {
    return { listed: t.listedInSeatfoldApp };
  }

  @Put()
  @Roles('OPERATOR_ADMIN')
  @ApiOperation({ summary: 'List or unlist this operator in the shared Seatfold app' })
  async set(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(z.object({ listed: z.boolean() }).strict())) body: { listed: boolean }) {
    await this.prisma.tenant.update({ where: { id: t.id }, data: { listedInSeatfoldApp: body.listed } });
    await this.prisma.auditLog.create({ data: { tenantId: t.id, actorId: a.sub, action: body.listed ? 'seatfold_app.listed' : 'seatfold_app.unlisted', entityType: 'Tenant', entityId: t.id, data: {} } });
    this.tenants.invalidate(t.slug);
    return { listed: body.listed };
  }
}

@Module({ imports: [TenantsModule], controllers: [DirectoryController, SeatfoldAppAdminController] })
export class DirectoryModule {}
