import { Body, Controller, Delete, Get, Headers, HttpCode, Module, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { Tenant } from '@prisma/client';
import { z } from 'zod';
import { AuditService } from '../common/common.module';
import { Clock } from '../common/clock';
import { Errors } from '../common/errors';
import { IdempotencyService } from '../common/idempotency.service';
import { PrismaService } from '../common/prisma.service';
import { AdminGuard, CurrentAdmin, CurrentTenant, CustomerGuard, CustomerId, Roles, TenantGuard } from '../common/tenant-context';
import { AdminClaims } from '../common/tokens';
import { ZodPipe } from '../common/zod.pipe';
import { PAYMENT_PROVIDER, SimulatedPaymentProvider } from '../payments/payment.provider';
import { entitlementsOf, entitlementsSchema, LoyaltyService, MembershipService, planDto, programDto } from './loyalty.service';

const purchaseBody = z.object({
  planId: z.string().min(1),
  payment: z.object({ type: z.literal('simulated'), outcome: z.enum(['approve', 'decline']).optional() }),
});

@ApiTags('Loyalty & memberships')
@ApiBearerAuth()
@Controller('v1/t/:tenant')
@UseGuards(TenantGuard)
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService, private readonly memberships: MembershipService, private readonly idem: IdempotencyService) {}

  /** Points balance and recent history. `program` is null when the operator has no scheme. */
  @Get('loyalty')
  @UseGuards(CustomerGuard)
  summary(@CurrentTenant() t: Tenant, @CustomerId() customerId: string) {
    return this.loyalty.summary(t.id, customerId);
  }

  @Get('membership/plans')
  plans(@CurrentTenant() t: Tenant) {
    return this.memberships.plans(t.id);
  }

  @Get('me/membership')
  @UseGuards(CustomerGuard)
  async mine(@CurrentTenant() t: Tenant, @CustomerId() customerId: string) {
    return { membership: await this.memberships.mine(t.id, customerId) };
  }

  @Post('me/membership')
  @HttpCode(201)
  @UseGuards(CustomerGuard)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  purchase(@CurrentTenant() t: Tenant, @CustomerId() customerId: string, @Headers('idempotency-key') key: string, @Body(new ZodPipe(purchaseBody)) body: z.infer<typeof purchaseBody>) {
    return this.idem.run(t.id, `membership:${customerId}`, key, body, () => this.memberships.purchase(t, customerId, body.planId, body.payment));
  }
}

const programBody = z
  .object({
    name: z.string().trim().min(1).max(40),
    enabled: z.boolean(),
    earnPointsPerPound: z.number().int().min(1).max(100),
    redeemPointsPerPound: z.number().int().min(1).max(10_000),
    minRedeemPoints: z.number().int().min(0).max(100_000).default(0),
  })
  // Guard against schemes that give away more than they take: 100% back or more is almost certainly a typo.
  .refine((p) => p.earnPointsPerPound < p.redeemPointsPerPound, 'Customers would get £1 or more back for every £1 spent. Earn fewer points per £1, or need more points per £1 off.');

const planBody = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(200).default(''),
  priceMinor: z.number().int().min(100).max(100_000),
  interval: z.enum(['month', 'year']),
  entitlements: entitlementsSchema,
  active: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(999).default(0),
});

@ApiTags('Admin')
@ApiBearerAuth()
@Controller('v1/admin/t/:tenant')
@UseGuards(AdminGuard)
export class AdminLoyaltyController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly clock: Clock) {}

  @Get('loyalty')
  async program(@CurrentTenant() t: Tenant) {
    const [program, stats] = await Promise.all([
      this.prisma.loyaltyProgram.findUnique({ where: { tenantId: t.id } }),
      this.prisma.loyaltyAccount.aggregate({ where: { tenantId: t.id }, _sum: { points: true }, _count: true }),
    ]);
    return {
      program: program ? { ...programDto(program), enabled: program.enabled } : null,
      stats: { accounts: stats._count, pointsOutstanding: stats._sum.points ?? 0 },
    };
  }

  @Put('loyalty')
  @Roles('OPERATOR_ADMIN')
  async setProgram(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(programBody)) b: z.infer<typeof programBody>) {
    const before = await this.prisma.loyaltyProgram.findUnique({ where: { tenantId: t.id } });
    await this.prisma.loyaltyProgram.upsert({ where: { tenantId: t.id }, create: { tenantId: t.id, ...b }, update: b });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'loyalty.update', entityType: 'LoyaltyProgram', data: { before, after: b } });
    return this.program(t);
  }

  @Get('membership-plans')
  async plans(@CurrentTenant() t: Tenant) {
    const now = this.clock.now();
    const [plans, counts] = await Promise.all([
      this.prisma.membershipPlan.findMany({ where: { tenantId: t.id }, orderBy: [{ sortOrder: 'asc' }, { priceMinor: 'asc' }] }),
      this.prisma.membership.groupBy({ by: ['planId'], where: { tenantId: t.id, currentPeriodEnd: { gt: now } }, _count: true }),
    ]);
    const active = new Map(counts.map((c) => [c.planId, c._count]));
    return plans.map((p) => ({ ...planDto(p), active: p.active, sortOrder: p.sortOrder, activeMembers: active.get(p.id) ?? 0 }));
  }

  @Post('membership-plans')
  @Roles('OPERATOR_ADMIN')
  async createPlan(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Body(new ZodPipe(planBody)) b: z.infer<typeof planBody>) {
    const row = await this.prisma.membershipPlan.create({ data: { tenantId: t.id, ...b } });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'membershipPlan.create', entityType: 'MembershipPlan', entityId: row.id, data: b });
    return { ...planDto(row), active: row.active, sortOrder: row.sortOrder, activeMembers: 0 };
  }

  /** Price and benefit changes apply to new purchases and renewals, and to benefits from now on. */
  @Put('membership-plans/:id')
  @Roles('OPERATOR_ADMIN')
  async updatePlan(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string, @Body(new ZodPipe(planBody.partial())) b: Partial<z.infer<typeof planBody>>) {
    const existing = await this.prisma.membershipPlan.findFirst({ where: { id, tenantId: t.id } });
    if (!existing) throw Errors.notFound('Membership plan');
    const entitlements = b.entitlements ? entitlementsSchema.parse({ ...entitlementsOf(existing), ...b.entitlements }) : undefined;
    const row = await this.prisma.membershipPlan.update({ where: { id }, data: { ...b, ...(entitlements ? { entitlements } : {}) } });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'membershipPlan.update', entityType: 'MembershipPlan', entityId: id, data: { before: planDto(existing), after: b } });
    return { ...planDto(row), active: row.active, sortOrder: row.sortOrder };
  }

  /** Plans anyone has ever bought are kept for the record; turn them off instead. */
  @Delete('membership-plans/:id')
  @HttpCode(204)
  @Roles('OPERATOR_ADMIN')
  async deletePlan(@CurrentTenant() t: Tenant, @CurrentAdmin() a: AdminClaims, @Param('id') id: string) {
    const existing = await this.prisma.membershipPlan.findFirst({ where: { id, tenantId: t.id } });
    if (!existing) throw Errors.notFound('Membership plan');
    const used = await this.prisma.membership.count({ where: { planId: id } });
    if (used) throw Errors.validation(`${used} customer${used === 1 ? ' has' : 's have'} bought this plan. Turn it off instead so it stops being sold.`);
    await this.prisma.membershipPlan.delete({ where: { id } });
    await this.audit.record({ tenantId: t.id, actorId: a.sub, action: 'membershipPlan.delete', entityType: 'MembershipPlan', entityId: id });
  }
}

@Module({
  controllers: [LoyaltyController, AdminLoyaltyController],
  providers: [LoyaltyService, MembershipService, { provide: PAYMENT_PROVIDER, useClass: SimulatedPaymentProvider }],
  exports: [LoyaltyService, MembershipService],
})
export class LoyaltyModule {}
