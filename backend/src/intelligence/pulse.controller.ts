import { Body, Controller, Get, HttpCode, Module, Param, Post, Query, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../common/zod.pipe';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Tenant } from '@prisma/client';
import { AdminGuard, CurrentTenant, CustomerGuard, CustomerId, TenantGuard } from '../common/tenant-context';
import { PulseService } from './pulse.service';
import { ASK_MODEL, askConfigured, PulseAssistant } from './assistant';

const askBody = z.object({
  question: z.string().trim().min(2).max(1000),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) })).max(12).optional(),
});

const simulateBody = z.object({
  venueId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  change: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('add'), filmId: z.string().min(1), auditoriumId: z.string().min(1), time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/) }),
    z.object({ kind: z.literal('remove'), screeningId: z.string().min(1) }),
    z.object({ kind: z.literal('move'), screeningId: z.string().min(1), auditoriumId: z.string().min(1) }),
    z.object({ kind: z.literal('price'), screeningId: z.string().min(1), percent: z.number().min(-50).max(50).refine((x) => x !== 0, 'Choose a change other than 0%') }),
  ]),
});

/**
 * Seatfold Pulse for operators: forecasts and what to do about them. Read-only, so every
 * portal role (including Reporting) can use it. See docs/pulse.md.
 */
@ApiTags('Pulse')
@ApiBearerAuth()
@Controller('v1/admin/t/:tenant/pulse')
@UseGuards(AdminGuard)
export class PulseAdminController {
  private readonly assistant: PulseAssistant;
  constructor(private readonly pulse: PulseService) {
    this.assistant = new PulseAssistant(pulse);
  }

  /** Whether Ask Pulse (the AI layer's conversational side) is switched on. Pulse works either way. */
  @Get('ask')
  askStatus() {
    return { configured: askConfigured(), model: askConfigured() ? ASK_MODEL : null };
  }

  /** Ask Pulse a question. Claude answers by calling Pulse's own endpoints; every figure comes from them. */
  @Post('ask')
  @HttpCode(200)
  ask(@CurrentTenant() t: Tenant, @Body(new ZodPipe(askBody)) b: z.infer<typeof askBody>) {
    return this.assistant.ask(t, b.question, b.history ?? []);
  }

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

  /** The week's best moves for the AI layer: simulated impact, confidence and where to act. */
  @Get('brief')
  brief(@CurrentTenant() t: Tenant) {
    return this.pulse.brief(t);
  }

  /** What-if for one cinema-day. Read-only: it changes nothing, so any portal role may run it. */
  @Post('simulate')
  @HttpCode(200)
  simulate(@CurrentTenant() t: Tenant, @Body(new ZodPipe(simulateBody)) b: z.infer<typeof simulateBody>) {
    return this.pulse.simulate(t, b);
  }

  /** Rolling-origin backtest: Pulse's accuracy on recent weeks it had not seen, with baselines. */
  @Get('accuracy')
  accuracy(@CurrentTenant() t: Tenant) {
    return this.pulse.accuracy(t);
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
