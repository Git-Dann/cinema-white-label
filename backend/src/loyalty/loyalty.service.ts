import { Inject, Injectable, Logger } from '@nestjs/common';
import { LoyaltyProgram, MembershipPlan, Prisma, Tenant } from '@prisma/client';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Clock } from '../common/clock';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { PAYMENT_PROVIDER, PaymentProvider } from '../payments/payment.provider';

// ---------------------------------------------------------------------------
// Loyalty points
// ---------------------------------------------------------------------------

export interface PointsRedemption {
  points: number;
  discountMinor: number;
}

export function programDto(p: LoyaltyProgram) {
  return {
    name: p.name,
    earnPointsPerPound: p.earnPointsPerPound,
    redeemPointsPerPound: p.redeemPointsPerPound,
    minRedeemPoints: p.minRedeemPoints,
  };
}

/**
 * Pure points maths, kept free of the database so the rules are easy to test
 * and to mirror in clients for display (clients still show server values).
 */
export const PointsMath = {
  /** Points earned on an amount paid (minor units, booking fees excluded). */
  earn(program: Pick<LoyaltyProgram, 'earnPointsPerPound'>, paidMinor: number, multiplier = 1): number {
    if (paidMinor <= 0) return 0;
    return Math.floor((paidMinor * program.earnPointsPerPound * multiplier) / 100);
  },

  /** The most points this order can take: whole pounds, within balance and the order value. */
  maxRedeemable(program: Pick<LoyaltyProgram, 'redeemPointsPerPound' | 'minRedeemPoints'>, balance: number, orderMinor: number): number {
    const step = program.redeemPointsPerPound;
    const byOrder = Math.floor(orderMinor / 100) * step;
    const max = Math.floor(Math.min(balance, byOrder) / step) * step;
    return max >= Math.max(step, program.minRedeemPoints) ? max : 0;
  },

  redeem(program: Pick<LoyaltyProgram, 'redeemPointsPerPound' | 'minRedeemPoints'>, balance: number, requested: number, orderMinor: number): PointsRedemption {
    if (!requested) return { points: 0, discountMinor: 0 };
    const step = program.redeemPointsPerPound;
    if (requested % step !== 0) throw Errors.pointsInvalid(`Points are used in steps of ${step} (£1 each)`);
    if (requested < program.minRedeemPoints) throw Errors.pointsInvalid(`Use at least ${program.minRedeemPoints} points at a time`);
    if (requested > balance) throw Errors.pointsInvalid(`You have ${balance} points`);
    const discountMinor = (requested / step) * 100;
    if (discountMinor > orderMinor) throw Errors.pointsInvalid('That is more points than this order needs');
    return { points: requested, discountMinor };
  },
};

type Tx = Prisma.TransactionClient;

@Injectable()
export class LoyaltyService {
  constructor(private readonly prisma: PrismaService) {}

  async program(tenantId: string): Promise<LoyaltyProgram | null> {
    const p = await this.prisma.loyaltyProgram.findUnique({ where: { tenantId } });
    return p?.enabled ? p : null;
  }

  async balance(customerId: string): Promise<number> {
    return (await this.prisma.loyaltyAccount.findUnique({ where: { customerId }, select: { points: true } }))?.points ?? 0;
  }

  async summary(tenantId: string, customerId: string) {
    const program = await this.program(tenantId);
    if (!program) return { program: null, points: 0, history: [] };
    const account = await this.prisma.loyaltyAccount.findUnique({
      where: { customerId },
      include: { entries: { orderBy: { createdAt: 'desc' }, take: 30 } },
    });
    return {
      program: programDto(program),
      points: account?.points ?? 0,
      // Worth this much off a future booking.
      valueMinor: Math.floor((account?.points ?? 0) / program.redeemPointsPerPound) * 100,
      history: (account?.entries ?? []).map((e) => ({ id: e.id, points: e.points, reason: e.reason, description: e.description, balanceAfter: e.balanceAfter, bookingId: e.bookingId, createdAt: e.createdAt })),
    };
  }

  private async account(tx: Tx, tenantId: string, customerId: string) {
    return tx.loyaltyAccount.upsert({ where: { customerId }, create: { tenantId, customerId }, update: {} });
  }

  /**
   * Inside the booking confirmation transaction: spend redeemed points (atomic,
   * fails if they were spent concurrently) and credit points earned.
   */
  async applyCheckout(tx: Tx, args: { tenantId: string; customerId: string; bookingId: string; redeem: number; earn: number; description: string }) {
    if (!args.redeem && !args.earn) return;
    const account = await this.account(tx, args.tenantId, args.customerId);
    let balance = account.points;
    if (args.redeem > 0) {
      const n = await tx.$executeRaw`UPDATE "LoyaltyAccount" SET "points" = "points" - ${args.redeem}, "updatedAt" = now() WHERE "id" = ${account.id} AND "points" >= ${args.redeem}`;
      if (n !== 1) throw Errors.pointsInvalid('Your points balance changed. Review your order and try again.');
      balance -= args.redeem;
      await tx.loyaltyLedgerEntry.create({ data: { accountId: account.id, points: -args.redeem, reason: 'redeem', description: args.description, balanceAfter: balance, bookingId: args.bookingId } });
    }
    if (args.earn > 0) {
      await tx.loyaltyAccount.update({ where: { id: account.id }, data: { points: { increment: args.earn } } });
      balance += args.earn;
      await tx.loyaltyLedgerEntry.create({ data: { accountId: account.id, points: args.earn, reason: 'earn', description: args.description, balanceAfter: balance, bookingId: args.bookingId } });
    }
  }

  /**
   * On cancellation: give back redeemed points and take back earned ones. If the
   * customer has already spent what they earned, only what remains is taken back
   * (the balance never goes negative); the ledger records the actual amount.
   */
  async reverseBooking(tx: Tx, b: { id: string; tenantId: string; customerId: string; pointsEarned: number; pointsRedeemed: number; reference: string }) {
    if (!b.pointsEarned && !b.pointsRedeemed) return;
    const [row] = await tx.$queryRaw<{ id: string; points: number }[]>`SELECT "id", "points" FROM "LoyaltyAccount" WHERE "customerId" = ${b.customerId} FOR UPDATE`;
    if (!row) return;
    let balance = row.points;
    if (b.pointsRedeemed > 0) {
      balance += b.pointsRedeemed;
      await tx.loyaltyLedgerEntry.create({ data: { accountId: row.id, points: b.pointsRedeemed, reason: 'refund_redeem', description: `Cancelled booking ${b.reference}`, balanceAfter: balance, bookingId: b.id } });
    }
    if (b.pointsEarned > 0) {
      const takeBack = Math.min(b.pointsEarned, balance);
      if (takeBack > 0) {
        balance -= takeBack;
        await tx.loyaltyLedgerEntry.create({ data: { accountId: row.id, points: -takeBack, reason: 'reverse_earn', description: `Cancelled booking ${b.reference}`, balanceAfter: balance, bookingId: b.id } });
      }
    }
    await tx.loyaltyAccount.update({ where: { id: row.id }, data: { points: balance } });
  }
}

// ---------------------------------------------------------------------------
// Memberships
// ---------------------------------------------------------------------------

export const entitlementsSchema = z.object({
  ticketDiscountPercent: z.number().int().min(0).max(100).default(0),
  foodDiscountPercent: z.number().int().min(0).max(100).default(0),
  bookingFeeWaived: z.boolean().default(false),
  /** Points earned are multiplied by this (1 to 5, in steps of 0.5). */
  pointsMultiplier: z.number().min(1).max(5).refine((n) => Number.isInteger(n * 2), 'Use steps of 0.5').default(1),
});
export type Entitlements = z.infer<typeof entitlementsSchema>;

export function entitlementsOf(plan: Pick<MembershipPlan, 'entitlements'>): Entitlements {
  const parsed = entitlementsSchema.safeParse(plan.entitlements ?? {});
  return parsed.success ? parsed.data : entitlementsSchema.parse({});
}

export function planDto(p: MembershipPlan) {
  return { id: p.id, name: p.name, description: p.description, priceMinor: p.priceMinor, interval: p.interval, entitlements: entitlementsOf(p) };
}

/** Adds one billing interval, clamping to the end of shorter months (31 Jan + 1 month = 28/29 Feb). */
export function addInterval(from: Date, interval: string): Date {
  const d = new Date(from);
  const day = d.getUTCDate();
  if (interval === 'year') d.setUTCFullYear(d.getUTCFullYear() + 1, d.getUTCMonth(), 1);
  else d.setUTCMonth(d.getUTCMonth() + 1, 1);
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, lastDay));
  return d;
}

@Injectable()
export class MembershipService {
  private readonly log = new Logger(MembershipService.name);
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
  ) {}

  async plans(tenantId: string) {
    const rows = await this.prisma.membershipPlan.findMany({ where: { tenantId, active: true }, orderBy: [{ sortOrder: 'asc' }, { priceMinor: 'asc' }] });
    return rows.map(planDto);
  }

  /** The customer's membership if it is currently in its paid period. */
  async active(tenantId: string, customerId: string) {
    const m = await this.prisma.membership.findFirst({ where: { tenantId, customerId }, include: { plan: true } });
    if (!m || m.currentPeriodEnd <= this.clock.now()) return null;
    return { membership: m, plan: m.plan, entitlements: entitlementsOf(m.plan) };
  }

  async mine(tenantId: string, customerId: string) {
    const m = await this.prisma.membership.findFirst({ where: { tenantId, customerId }, include: { plan: true } });
    if (!m) return null;
    const now = this.clock.now();
    return {
      plan: planDto(m.plan),
      status: m.currentPeriodEnd > now ? 'active' : 'expired',
      startedAt: m.startedAt,
      currentPeriodEnd: m.currentPeriodEnd,
      // No automatic renewal until a real payment provider supports recurring billing.
      renewal: 'manual' as const,
    };
  }

  /**
   * Buys (or renews) a membership period. Renewing the same plan extends from
   * the current end date; switching plans is only allowed once the current one ends.
   */
  async purchase(tenant: Tenant, customerId: string, planId: string, method: { type: 'simulated'; outcome?: 'approve' | 'decline' }) {
    if (method.type === 'simulated' && process.env.NODE_ENV === 'production' && process.env.ALLOW_SIMULATED_PAYMENTS !== 'true') {
      throw Errors.validation('Simulated payments are disabled in production');
    }
    const plan = await this.prisma.membershipPlan.findFirst({ where: { id: planId, tenantId: tenant.id, active: true } });
    if (!plan) throw Errors.notFound('Membership plan');
    const now = this.clock.now();
    const existing = await this.prisma.membership.findUnique({ where: { customerId }, include: { plan: true } });
    const isActive = !!existing && existing.currentPeriodEnd > now;
    if (isActive && existing.planId !== plan.id) {
      throw Errors.membershipNotAllowed(`You're a ${existing.plan.name} member until ${existing.currentPeriodEnd.toISOString().slice(0, 10)}. You can change plan after that.`);
    }
    const periodStart = isActive ? existing.currentPeriodEnd : now;
    const periodEnd = addInterval(periodStart, plan.interval);

    const payment = await this.payments.authoriseAndCapture({
      amountMinor: plan.priceMinor,
      currency: tenant.currency,
      idempotencyKey: `membership-${randomUUID()}`,
      description: `${plan.name} membership`,
      method,
    });
    if (payment.status === 'declined') throw Errors.paymentDeclined(payment.reason);

    try {
      await this.prisma.$transaction(async (tx) => {
        const m = await tx.membership.upsert({
          where: { customerId },
          create: { tenantId: tenant.id, customerId, planId: plan.id, startedAt: now, currentPeriodEnd: periodEnd },
          update: { planId: plan.id, currentPeriodEnd: periodEnd, ...(isActive ? {} : { startedAt: now }) },
        });
        await tx.membershipPurchase.create({
          data: { tenantId: tenant.id, membershipId: m.id, planId: plan.id, provider: payment.provider, providerRef: payment.providerRef, amountMinor: plan.priceMinor, currency: tenant.currency, periodStart, periodEnd },
        });
      });
    } catch (e) {
      this.log.warn(`Membership purchase failed after payment ${payment.providerRef}; refunding`);
      await this.payments.voidOrRefund(payment.providerRef, plan.priceMinor);
      throw e;
    }
    return { ...(await this.mine(tenant.id, customerId))!, payment: { provider: payment.provider, simulated: payment.provider === 'simulated', amountMinor: plan.priceMinor } };
  }
}
