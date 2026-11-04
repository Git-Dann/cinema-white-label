import { Body, Controller, HttpCode, Module, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Tenant } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { CurrentTenant, TenantGuard } from '../common/tenant-context';
import { ZodPipe } from '../common/zod.pipe';

/**
 * Event names are an allow-list so the app cannot be used to collect arbitrary
 * data. Properties are limited to non-personal identifiers (UK GDPR data
 * minimisation): no names, emails, precise location or payment details.
 */
export const ANALYTICS_EVENTS = [
  'app_opened', 'cinema_selected', 'cinema_favourited', 'film_viewed', 'screening_viewed', 'seat_selector_opened',
  'seat_selected', 'seat_changed', 'seat_hold_failed', 'booking_abandoned', 'checkout_started', 'payment_completed',
  'booking_confirmed', 'wallet_pass_requested', 'wallet_pass_issued', 'food_order_created', 'membership_viewed', 'theme_load_failed',
] as const;

const FORBIDDEN_KEYS = /email|name|phone|address|lat|lng|latitude|longitude|card|token/i;

const batch = z.object({
  events: z
    .array(
      z.object({
        name: z.enum(ANALYTICS_EVENTS),
        occurredAt: z.string().datetime(),
        sessionId: z.string().max(64).optional(),
        properties: z.record(z.union([z.string().max(200), z.number(), z.boolean()])).default({}),
      }),
    )
    .max(100),
});

@ApiTags('Analytics')
@Controller('v1/t/:tenant/analytics')
@UseGuards(TenantGuard)
export class AnalyticsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('events')
  @HttpCode(202)
  async ingest(@CurrentTenant() t: Tenant, @Body(new ZodPipe(batch)) body: z.infer<typeof batch>) {
    const rows = body.events.map((e) => ({
      tenantId: t.id,
      name: e.name,
      sessionId: e.sessionId ?? null,
      occurredAt: new Date(e.occurredAt),
      properties: Object.fromEntries(Object.entries(e.properties).filter(([k]) => !FORBIDDEN_KEYS.test(k))),
    }));
    await this.prisma.analyticsEvent.createMany({ data: rows });
    return { accepted: rows.length };
  }
}

@Module({ controllers: [AnalyticsController] })
export class AnalyticsModule {}
