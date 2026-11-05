import { Body, Controller, Delete, Get, Headers, HttpCode, MessageEvent, Module, Param, Post, Query, Sse, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Tenant } from '@prisma/client';
import { Observable } from 'rxjs';
import { z } from 'zod';
import { IdempotencyService } from '../common/idempotency.service';
import { CurrentTenant, CustomerGuard, CustomerId, OptionalCustomerGuard, TenantGuard } from '../common/tenant-context';
import { ZodPipe } from '../common/zod.pipe';
import { HoldsService } from '../holds/holds.service';
import { PAYMENT_PROVIDER, SimulatedPaymentProvider } from '../payments/payment.provider';
import { PricingService } from '../pricing/pricing.service';
import { AvailabilityEvents } from '../screenings/availability.events';
import { ScreeningsService } from '../screenings/screenings.service';
import { DemoWalletPassIssuer, WALLET_ISSUER } from '../wallet/wallet.issuer';
import { BookingsService } from './bookings.service';
import { CommerceService, concessionSelectionSchema } from '../commerce/commerce.service';
import { LoyaltyModule } from '../loyalty/loyalty.module';

const dateRe = /^\d{4}-\d{2}-\d{2}$/;

@ApiTags('Screenings')
@Controller('v1/t/:tenant')
@UseGuards(TenantGuard)
export class ScreeningsController {
  constructor(private readonly screenings: ScreeningsService, private readonly events: AvailabilityEvents, private readonly commerce: CommerceService) {}

  @Get('screenings')
  @ApiQuery({ name: 'venueId', required: false })
  @ApiQuery({ name: 'filmId', required: false })
  @ApiQuery({ name: 'date', required: false, description: 'YYYY-MM-DD in the venue time zone' })
  @ApiQuery({ name: 'days', required: false })
  list(@CurrentTenant() t: Tenant, @Query('venueId') venueId?: string, @Query('filmId') filmId?: string, @Query('date') date?: string, @Query('days') days?: string) {
    return this.screenings.list(t.id, { venueId, filmId, date: date && dateRe.test(date) ? date : undefined, days: days ? Math.min(14, Number(days) || 7) : undefined });
  }

  @Get('venues/:venueId/dates')
  dates(@CurrentTenant() t: Tenant, @Param('venueId') venueId: string, @Query('filmId') filmId?: string) {
    return this.screenings.dates(t.id, venueId, filmId);
  }

  @Get('venues/:venueId/concessions')
  concessions(@CurrentTenant() t: Tenant, @Param('venueId') venueId: string) {
    return this.commerce.menu(t.id, venueId);
  }

  @Get('screenings/:id')
  detail(@CurrentTenant() t: Tenant, @Param('id') id: string) {
    return this.screenings.detail(t, id);
  }

  @Get('screenings/:id/availability')
  @UseGuards(OptionalCustomerGuard)
  availability(@CurrentTenant() t: Tenant, @Param('id') id: string, @CustomerId() customerId?: string) {
    return this.screenings.availability(t.id, id, customerId);
  }

  /** Server-sent seat changes. Clients fall back to polling the availability endpoint. */
  @Sse('screenings/:id/availability/stream')
  stream(@Param('id') id: string): Observable<MessageEvent> {
    return new Observable<MessageEvent>((sub) => {
      const unsubscribe = this.events.subscribe(id, (c) => sub.next({ type: 'seats', data: c }));
      const keepAlive = setInterval(() => sub.next({ type: 'ping', data: { t: Date.now() } }), 20_000);
      return () => {
        unsubscribe();
        clearInterval(keepAlive);
      };
    });
  }
}

const holdBody = z.object({ screeningId: z.string().min(1), seatIds: z.array(z.string().min(1)).min(1).max(50) });
const ticketsSchema = z.array(z.object({ seatId: z.string(), ticketTypeId: z.string() })).min(1).max(50);
const extras = {
  concessions: z.array(concessionSelectionSchema).max(30).default([]),
  voucherCode: z.string().max(40).optional(),
  fulfilment: z.enum(['collect', 'seatDelivery']).default('collect'),
  loyaltyPoints: z.number().int().min(0).max(1_000_000).default(0),
};
const quoteBody = z.object({ holdId: z.string(), tickets: ticketsSchema, ...extras });
const checkoutBody = z.object({
  holdId: z.string(),
  tickets: ticketsSchema,
  ...extras,
  payment: z.object({ type: z.literal('simulated'), outcome: z.enum(['approve', 'decline']).optional() }),
});

@ApiTags('Booking')
@ApiBearerAuth()
@Controller('v1/t/:tenant')
@UseGuards(TenantGuard, CustomerGuard)
export class BookingController {
  constructor(private readonly holds: HoldsService, private readonly bookings: BookingsService, private readonly idem: IdempotencyService) {}

  @Post('holds')
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  createHold(@CurrentTenant() t: Tenant, @CustomerId() customerId: string, @Headers('idempotency-key') key: string, @Body(new ZodPipe(holdBody)) body: z.infer<typeof holdBody>) {
    return this.idem.run(t.id, `hold:${customerId}`, key, body, () => this.holds.create(t, customerId, body.screeningId, body.seatIds));
  }

  @Get('holds/:id')
  getHold(@CurrentTenant() t: Tenant, @CustomerId() customerId: string, @Param('id') id: string) {
    return this.holds.get(t.id, customerId, id);
  }

  @Delete('holds/:id')
  @HttpCode(204)
  releaseHold(@CurrentTenant() t: Tenant, @CustomerId() customerId: string, @Param('id') id: string) {
    return this.holds.release(t.id, customerId, id);
  }

  @Post('quotes')
  @HttpCode(200)
  quote(@CurrentTenant() t: Tenant, @CustomerId() customerId: string, @Body(new ZodPipe(quoteBody)) body: z.infer<typeof quoteBody>) {
    return this.bookings.quote(t, customerId, body.holdId, body.tickets, body);
  }

  @Post('checkout')
  @HttpCode(201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  checkout(@CurrentTenant() t: Tenant, @CustomerId() customerId: string, @Headers('idempotency-key') key: string, @Body(new ZodPipe(checkoutBody)) body: z.infer<typeof checkoutBody>) {
    return this.idem.run(t.id, `checkout:${customerId}`, key, body, () => this.bookings.checkout(t, customerId, body));
  }

  @Get('me/bookings')
  list(@CurrentTenant() t: Tenant, @CustomerId() customerId: string) {
    return this.bookings.list(t.id, customerId);
  }

  @Get('bookings/:id')
  get(@CurrentTenant() t: Tenant, @CustomerId() customerId: string, @Param('id') id: string) {
    return this.bookings.get(t.id, customerId, id);
  }

  @Post('bookings/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentTenant() t: Tenant, @CustomerId() customerId: string, @Param('id') id: string) {
    return this.bookings.cancel(t, customerId, id);
  }

  @Post('bookings/:id/wallet-pass')
  @HttpCode(200)
  wallet(@CurrentTenant() t: Tenant, @CustomerId() customerId: string, @Param('id') id: string) {
    return this.bookings.requestWalletPass(t, customerId, id);
  }
}

@Module({
  imports: [LoyaltyModule],
  controllers: [ScreeningsController, BookingController],
  providers: [
    ScreeningsService,
    HoldsService,
    PricingService,
    BookingsService,
    CommerceService,
    AvailabilityEvents,
    { provide: PAYMENT_PROVIDER, useClass: SimulatedPaymentProvider },
    { provide: WALLET_ISSUER, useClass: DemoWalletPassIssuer },
  ],
  exports: [HoldsService, BookingsService, AvailabilityEvents, PAYMENT_PROVIDER],
})
export class BookingModule {}
