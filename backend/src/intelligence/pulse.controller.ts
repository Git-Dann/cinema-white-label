import { Controller, Get, Module, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Tenant } from '@prisma/client';
import { AdminGuard, CurrentTenant, CustomerGuard, CustomerId, TenantGuard } from '../common/tenant-context';
import { PulseService } from './pulse.service';

/**
 * Seatfold Pulse for operators: forecasts and what to do about them. Read-only, so every
 * portal role (including Reporting) can use it. See docs/pulse.md.
 */
@ApiTags('Pulse')
@ApiBearerAuth()
@Controller('v1/admin/t/:tenant/pulse')
@UseGuards(AdminGuard)
export class PulseAdminController {
  constructor(private readonly pulse: PulseService) {}

  @Get('forecasts')
  @ApiQuery({ name: 'venueId', required: false })
  @ApiQuery({ name: 'from', required: false, description: 'ISO date or time; default now' })
  @ApiQuery({ name: 'to', required: false, description: 'Default 14 days after from; at most 42' })
  forecasts(@CurrentTenant() t: Tenant, @Query('venueId') venueId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.pulse.forecasts(t, { venueId, from, to });
  }

  @Get('pricing')
  pricing(@CurrentTenant() t: Tenant) {
    return this.pulse.pricing(t);
  }

  @Get('screens')
  screens(@CurrentTenant() t: Tenant) {
    return this.pulse.screens(t);
  }

  @Get('staffing')
  @ApiQuery({ name: 'venueId', required: true })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD in the cinema time zone' })
  staffing(@CurrentTenant() t: Tenant, @Query('venueId') venueId?: string, @Query('date') date?: string) {
    return this.pulse.staffing(t, venueId, date);
  }

  @Get('food')
  @ApiQuery({ name: 'venueId', required: true })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD in the cinema time zone' })
  food(@CurrentTenant() t: Tenant, @Query('venueId') venueId?: string, @Query('date') date?: string) {
    return this.pulse.food(t, venueId, date);
  }

  @Get('baskets')
  baskets(@CurrentTenant() t: Tenant) {
    return this.pulse.baskets(t);
  }

  @Get('loyalty')
  loyalty(@CurrentTenant() t: Tenant) {
    return this.pulse.loyalty(t);
  }

  @Get('anomalies')
  anomalies(@CurrentTenant() t: Tenant) {
    return this.pulse.anomalies(t);
  }

  @Get('model')
  model(@CurrentTenant() t: Tenant) {
    return this.pulse.model(t);
  }
}

/** Pulse for customers: films they might like. */
@ApiTags('Pulse')
@Controller('v1/t/:tenant')
@UseGuards(TenantGuard)
export class PulseCustomerController {
  constructor(private readonly pulse: PulseService) {}

  @Get('me/recommendations')
  @UseGuards(CustomerGuard)
  recommendations(@CurrentTenant() t: Tenant, @CustomerId() customerId: string) {
    return this.pulse.recommendations(t, customerId);
  }

  @Get('films/:filmId/also-booked')
  alsoBooked(@CurrentTenant() t: Tenant, @Param('filmId') filmId: string) {
    return this.pulse.alsoBooked(t, filmId);
  }
}

@Module({ controllers: [PulseAdminController, PulseCustomerController], providers: [PulseService], exports: [PulseService] })
export class PulseModule {}
