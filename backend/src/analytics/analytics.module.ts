import { Body, Controller, HttpCode, Module, Post, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Tenant } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../common/prisma.service';
import { CurrentTenant, TenantGuard } from '../common/tenant-context';
import { ZodPipe } from '../common/zod.pipe';

/**
 * Typed event schema. Each event declares the properties it may carry; any
 * other property is dropped. Values are identifiers, codes and counts only,
 * never personal data (UK GDPR data minimisation). The Swift mirror is
 * `AnalyticsEventName` / `AnalyticsEvent` in CinemaCore.
 */
const id = z.string().max(64);
const code = z.string().max(40);
const count = z.coerce.number().int().min(0).max(10_000);
export const EVENT_SCHEMAS = {
  app_opened: {},
  cinema_selected: { venueId: id },
  cinema_favourited: { venueId: id },
  film_impression: { filmId: id, list: code, position: count },
  film_viewed: { filmId: id },
  screening_viewed: { screeningId: id },
  screening_selected: { screeningId: id, filmId: id, venueId: id },
  seat_selector_opened: { screeningId: id },
  seat_map_zoomed: { screeningId: id, method: code },
  seat_selected: { screeningId: id, category: code },
  seat_changed: { screeningId: id },
  seat_hold_failed: { screeningId: id, code },
  ticket_type_changed: { screeningId: id, ticketType: code },
  food_added: { productId: id, quantity: count },
  food_removed: { productId: id },
  voucher_applied: { result: code },
  booking_abandoned: { screeningId: id, step: code },
  checkout_started: { screeningId: id },
  checkout_failed: { screeningId: id, code },
  payment_completed: { screeningId: id },
  booking_confirmed: { screeningId: id, seats: count, foodItems: count },
  booking_cancelled: { bookingId: id },
  wallet_pass_requested: { bookingId: id },
  wallet_pass_issued: { bookingId: id },
  food_order_created: { bookingId: id, items: count },
  membership_viewed: {},
  membership_engaged: { action: code },
  theme_load_failed: { reason: z.string().max(120) },
  tickets_refresh_failed: { reason: z.string().max(120) },
} as const satisfies Record<string, Record<string, z.ZodTypeAny>>;

export type AnalyticsEventName = keyof typeof EVENT_SCHEMAS;
export const ANALYTICS_EVENTS = Object.keys(EVENT_SCHEMAS) as [AnalyticsEventName, ...AnalyticsEventName[]];

/** Keeps only declared, valid properties for an event. */
export function sanitiseProperties(name: AnalyticsEventName, props: Record<string, unknown>): Record<string, string | number> {
  const schema = EVENT_SCHEMAS[name] as Record<string, z.ZodTypeAny>;
  const out: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(schema)) {
    const r = v.safeParse(props[k]);
    if (r.success && r.data !== undefined) out[k] = r.data as string | number;
  }
  return out;
}

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
      properties: sanitiseProperties(e.name, e.properties),
    }));
    await this.prisma.analyticsEvent.createMany({ data: rows });
    return { accepted: rows.length };
  }
}

@Module({ controllers: [AnalyticsController] })
export class AnalyticsModule {}
