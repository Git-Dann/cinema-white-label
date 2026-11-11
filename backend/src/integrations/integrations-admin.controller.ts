import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Tenant } from '@prisma/client';
import { z } from 'zod';
import { Clock } from '../common/clock';
import { AuditService } from '../common/common.module';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { AdminGuard, CurrentAdmin, CurrentTenant, Roles } from '../common/tenant-context';
import { AdminClaims } from '../common/tokens';
import { ZodPipe } from '../common/zod.pipe';
import { newApiKey, newWebhookSecret, webhookUrlProblem } from './keys';
import { shiftDto } from './partner.controller';
import { EVENT_IDS, EVENTS, SCOPE_IDS, SCOPES } from './scopes';
import { WebhookService } from './webhooks.service';

const keyBody = z.object({ name: z.string().trim().min(1).max(60), scopes: z.array(z.enum(SCOPE_IDS as [string, ...string[]])).min(1) });
const hookBody = z.object({ url: z.string().trim().max(500), description: z.string().trim().max(120).nullable().optional(), events: z.array(z.enum(EVENT_IDS as [string, ...string[]])).min(1) });
const hookPatch = z.object({ url: z.string().trim().max(500).optional(), description: z.string().trim().max(120).nullable().optional(), events: z.array(z.enum(EVENT_IDS as [string, ...string[]])).min(1).optional(), active: z.boolean().optional() });

function urlOk(url: string) {
  const problem = webhookUrlProblem(url);
  if (problem) throw Errors.validation(problem);
}

/**
 * Connections: the operator's API keys and webhooks, and the shifts rota systems
 * have sent. Viewing is open to every portal role; creating or changing keys and
 * webhooks is for operator admins only.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Controller('v1/admin/t/:tenant')
@UseGuards(AdminGuard)
export class IntegrationsAdminController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly webhooks: WebhookService, private readonly clock: Clock) {}

  @Get('integrations/catalogue')
  catalogue() {
    return { scopes: Object.entries(SCOPES).map(([id, label]) => ({ id, label })), events: Object.entries(EVENTS).map(([id, label]) => ({ id, label })) };
  }

  @Get('api-keys')
  async keys(@CurrentTenant() t: Tenant) {
    const rows = await this.prisma.apiKey.findMany({ where: { tenantId: t.id }, orderBy: [{ revokedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }] });
    return rows.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, createdAt: k.createdAt.toISOString(), lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null }));
  }

  /** Creates a key and returns it once. Afterwards only its first characters are shown. */
  @Post('api-keys')
  @Roles('OPERATOR_ADMIN')
  async createKey(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(keyBody)) b: z.infer<typeof keyBody>) {
    const { key, prefix, hash } = newApiKey();
    const row = await this.prisma.apiKey.create({ data: { tenantId: t.id, name: b.name, prefix, keyHash: hash, scopes: [...new Set(b.scopes)], createdById: a.sub } });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'api_key.create', entityType: 'ApiKey', entityId: row.id, data: { name: b.name, scopes: row.scopes } });
    return { id: row.id, name: row.name, prefix, scopes: row.scopes, key };
  }

  @Delete('api-keys/:id')
  @HttpCode(204)
  @Roles('OPERATOR_ADMIN')
  async revokeKey(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string) {
    const { count } = await this.prisma.apiKey.updateMany({ where: { id, tenantId: t.id, revokedAt: null }, data: { revokedAt: this.clock.now() } });
    if (!count) throw Errors.notFound('API key');
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'api_key.revoke', entityType: 'ApiKey', entityId: id, data: {} });
  }

  @Get('webhooks')
  async hooks(@CurrentTenant() t: Tenant) {
    const rows = await this.prisma.webhook.findMany({ where: { tenantId: t.id }, include: { deliveries: { orderBy: { createdAt: 'desc' }, take: 10 } }, orderBy: { createdAt: 'desc' } });
    return rows.map((h) => ({
      id: h.id, url: h.url, description: h.description, events: h.events, active: h.active, createdAt: h.createdAt.toISOString(),
      deliveries: h.deliveries.map((d) => ({ id: d.id, event: d.event, eventId: d.eventId, status: d.status, responseCode: d.responseCode, error: d.error, attempts: d.attempts, durationMs: d.durationMs, createdAt: d.createdAt.toISOString() })),
    }));
  }

  /** Creates a webhook and returns its signing secret once. */
  @Post('webhooks')
  @Roles('OPERATOR_ADMIN')
  async createHook(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(hookBody)) b: z.infer<typeof hookBody>) {
    urlOk(b.url);
    const secret = newWebhookSecret();
    const row = await this.prisma.webhook.create({ data: { tenantId: t.id, url: b.url, description: b.description ?? null, events: [...new Set(b.events)], secret } });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'webhook.create', entityType: 'Webhook', entityId: row.id, data: { url: b.url, events: row.events } });
    return { id: row.id, url: row.url, events: row.events, secret };
  }

  @Put('webhooks/:id')
  @Roles('OPERATOR_ADMIN')
  async updateHook(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string, @Body(new ZodPipe(hookPatch)) b: z.infer<typeof hookPatch>) {
    const hook = await this.prisma.webhook.findFirst({ where: { id, tenantId: t.id } });
    if (!hook) throw Errors.notFound('Webhook');
    if (b.url) urlOk(b.url);
    const row = await this.prisma.webhook.update({ where: { id }, data: { ...b, ...(b.events ? { events: [...new Set(b.events)] } : {}) } });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'webhook.update', entityType: 'Webhook', entityId: id, data: b });
    return { id: row.id, url: row.url, events: row.events, active: row.active };
  }

  @Delete('webhooks/:id')
  @HttpCode(204)
  @Roles('OPERATOR_ADMIN')
  async deleteHook(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string) {
    const { count } = await this.prisma.webhook.deleteMany({ where: { id, tenantId: t.id } });
    if (!count) throw Errors.notFound('Webhook');
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'webhook.delete', entityType: 'Webhook', entityId: id, data: {} });
  }

  /** Sends a "ping" event so the receiver can be checked before real events flow. */
  @Post('webhooks/:id/test')
  @Roles('OPERATOR_ADMIN')
  async testHook(@CurrentTenant() t: Tenant, @Param('id') id: string) {
    const hook = await this.prisma.webhook.findFirst({ where: { id, tenantId: t.id } });
    if (!hook) throw Errors.notFound('Webhook');
    const d = await this.webhooks.deliver(hook, { id: `evt_test_${Date.now()}`, type: 'ping', createdAt: this.clock.now().toISOString(), data: { message: 'Hello from Seatfold' } });
    return { status: d.status, responseCode: d.responseCode, error: d.error };
  }

  /** Sends a failed (or any) delivery again with the same event id, so receivers can ignore repeats. */
  @Post('webhook-deliveries/:id/resend')
  @Roles('OPERATOR_ADMIN')
  async resend(@CurrentTenant() t: Tenant, @Param('id') id: string) {
    const d = await this.prisma.webhookDelivery.findFirst({ where: { id, webhook: { tenantId: t.id } }, include: { webhook: true } });
    if (!d) throw Errors.notFound('Delivery');
    const again = await this.webhooks.deliver(d.webhook, d.payload as { id: string; type: string; createdAt: string; data: unknown });
    return { status: again.status, responseCode: again.responseCode, error: again.error };
  }

  /** Shifts from connected rota systems, for My week and Today. */
  @Get('shifts')
  @ApiQuery({ name: 'venueId', required: false }) @ApiQuery({ name: 'from', required: false }) @ApiQuery({ name: 'to', required: false })
  async shifts(@CurrentTenant() t: Tenant, @Query('venueId') venueId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    const start = from ? new Date(from) : new Date(this.clock.now().getTime() - 86400_000);
    const end = to ? new Date(to) : new Date(start.getTime() + 15 * 86400_000);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) throw Errors.validation('from and to must be ISO dates');
    const rows = await this.prisma.shift.findMany({ where: { tenantId: t.id, startsAt: { gte: start, lt: end }, ...(venueId ? { venueId } : {}) }, orderBy: { startsAt: 'asc' }, take: 1000 });
    return rows.map(shiftDto);
  }
}
