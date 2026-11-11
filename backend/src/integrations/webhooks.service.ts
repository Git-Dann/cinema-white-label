import { Injectable, Logger } from '@nestjs/common';
import { Prisma, Webhook } from '@prisma/client';
import { randomUUID } from 'crypto';
import { Clock } from '../common/clock';
import { PrismaService } from '../common/prisma.service';
import { signPayload } from './keys';
import { partnerBooking, partnerBookingInclude } from './partner-dto';
import { EventType } from './scopes';

const TIMEOUT_MS = 4000;

/**
 * Sends signed events to the operator's webhooks and records every delivery.
 * A delivery is tried twice (a network error or 5xx gets one immediate retry);
 * a failed one can be resent from the portal. Webhooks never hold up or undo a booking:
 * every error is caught and logged against the delivery.
 */
@Injectable()
export class WebhookService {
  private readonly log = new Logger(WebhookService.name);
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock) {}

  async emit(tenantId: string, type: EventType, data: unknown) {
    try {
      const hooks = await this.prisma.webhook.findMany({ where: { tenantId, active: true, events: { has: type } } });
      if (!hooks.length) return;
      const event = { id: `evt_${randomUUID()}`, type, createdAt: this.clock.now().toISOString(), data };
      await Promise.all(hooks.map((h) => this.deliver(h, event)));
    } catch (e) {
      this.log.warn(`Webhook emit ${type} failed: ${(e as Error).message}`);
    }
  }

  /** Booking events carry the partner view of the booking (no customer details). */
  async emitBooking(tenantId: string, type: 'booking.confirmed' | 'booking.refunded', bookingId: string) {
    try {
      if (!(await this.prisma.webhook.count({ where: { tenantId, active: true, events: { has: type } } }))) return;
      const b = await this.prisma.booking.findUnique({ where: { id: bookingId }, include: partnerBookingInclude });
      if (b) await this.emit(tenantId, type, partnerBooking(b));
    } catch (e) {
      this.log.warn(`Webhook ${type} for ${bookingId} failed: ${(e as Error).message}`);
    }
  }

  async deliver(hook: Webhook, event: { id: string; type: string; createdAt: string; data: unknown }) {
    const body = JSON.stringify(event);
    let attempts = 0;
    let code: number | null = null;
    let error: string | null = null;
    const started = Date.now();
    while (attempts < 2) {
      attempts++;
      try {
        const res = await fetch(hook.url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'user-agent': 'Seatfold-Webhooks/1',
            'seatfold-event': event.type,
            'seatfold-event-id': event.id,
            'seatfold-signature': signPayload(hook.secret, body, this.clock.now()),
          },
          body,
          redirect: 'manual',
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
        code = res.status;
        error = res.ok ? null : `HTTP ${res.status}`;
        if (res.ok || res.status < 500) break;
      } catch (e) {
        code = null;
        error = (e as Error).name === 'TimeoutError' ? `No answer within ${TIMEOUT_MS / 1000}s` : (e as Error).message;
      }
    }
    return this.prisma.webhookDelivery.create({
      data: {
        webhookId: hook.id, event: event.type, eventId: event.id, payload: event as unknown as Prisma.InputJsonValue,
        status: error ? 'failed' : 'delivered', responseCode: code, error, attempts, durationMs: Date.now() - started,
      },
    });
  }
}
