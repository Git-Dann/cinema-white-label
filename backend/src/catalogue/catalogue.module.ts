import { Controller, Get, Module, Param, Query, UseGuards } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { Tenant } from '@prisma/client';
import { CurrentTenant, TenantGuard } from '../common/tenant-context';
import { FilmsService } from './films.service';

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

@Module({ controllers: [FilmsController], providers: [FilmsService], exports: [FilmsService] })
export class CatalogueModule {}
