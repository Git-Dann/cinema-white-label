import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { Prisma, SeatHold, Tenant } from '@prisma/client';
import { AuditoriumLayout } from '@cinema/contracts';
import { Clock } from '../common/clock';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { AvailabilityEvents } from '../screenings/availability.events';
import { evaluateSeatRules, RuleViolation } from './seat-rules';

type Tx = Prisma.TransactionClient;

interface LockedSeat {
  seatId: string;
  state: 'AVAILABLE' | 'HELD' | 'SOLD' | 'BLOCKED';
  holdId: string | null;
  heldUntil: Date | null;
}

export interface HoldDto {
  id: string;
  screeningId: string;
  seatIds: string[];
  status: SeatHold['status'];
  expiresAt: string;
  serverTime: string;
  warnings: RuleViolation[];
}

/**
 * Seat reservation engine. The database is the single source of truth:
 *  - Seat rows are locked with SELECT ... FOR UPDATE in a stable order
 *    (prevents deadlocks between overlapping requests).
 *  - A seat can be taken if AVAILABLE, or HELD by an expired/own hold.
 *  - Expiry is server-defined; clients only display it.
 * State machine: AVAILABLE → HELD → SOLD, HELD → (expired/released) → AVAILABLE.
 */
@Injectable()
export class HoldsService {
  private readonly log = new Logger(HoldsService.name);
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock, private readonly events: AvailabilityEvents) {}

  private toDto(h: SeatHold, warnings: RuleViolation[] = []): HoldDto {
    return { id: h.id, screeningId: h.screeningId, seatIds: h.seatIds, status: h.status, expiresAt: h.expiresAt.toISOString(), serverTime: this.clock.now().toISOString(), warnings };
  }

  private async loadScreening(tx: Tx | PrismaService, tenantId: string, screeningId: string) {
    const s = await tx.screening.findFirst({ where: { id: screeningId, tenantId }, include: { layoutVersion: true } });
    if (!s) throw Errors.notFound('Screening');
    if (s.status !== 'SCHEDULED' || s.startsAt <= this.clock.now()) throw Errors.screeningClosed();
    return { screening: s, layout: s.layoutVersion.geometry as unknown as AuditoriumLayout };
  }

  private async lockSeats(tx: Tx, screeningId: string, seatIds: string[]): Promise<LockedSeat[]> {
    const ordered = [...seatIds].sort();
    return tx.$queryRaw<LockedSeat[]>`
      SELECT "seatId", "state"::text AS "state", "holdId", "heldUntil"
      FROM "ScreeningSeat"
      WHERE "screeningId" = ${screeningId} AND "seatId" = ANY(${ordered})
      ORDER BY "seatId"
      FOR UPDATE`;
  }

  private isTakeable(row: LockedSeat, ownHoldId: string | null, now: Date) {
    if (row.state === 'AVAILABLE') return true;
    if (row.state === 'HELD') return row.holdId === ownHoldId || (row.heldUntil !== null && row.heldUntil <= now);
    return false;
  }

  /** Seats the customer cannot take, for rule evaluation (orphan detection). */
  private async unavailableSet(tx: Tx, screeningId: string, ownHoldId: string | null, now: Date): Promise<Set<string>> {
    const rows = await tx.screeningSeat.findMany({ where: { screeningId, state: { not: 'AVAILABLE' } }, select: { seatId: true, state: true, holdId: true, heldUntil: true } });
    return new Set(rows.filter((r) => !this.isTakeable(r as LockedSeat, ownHoldId, now)).map((r) => r.seatId));
  }

  async create(tenant: Tenant, customerId: string, screeningId: string, seatIds: string[]): Promise<HoldDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const now = this.clock.now();
      const { layout } = await this.loadScreening(tx, tenant.id, screeningId);

      // One active hold per customer per screening: a new request replaces it.
      const previous = await tx.seatHold.findFirst({ where: { screeningId, customerId, status: 'ACTIVE' } });
      const rules = evaluateSeatRules(layout, seatIds, await this.unavailableSet(tx, screeningId, previous?.id ?? null, now), {
        maxTickets: tenant.maxTicketsPerBooking,
        orphanSeatPolicy: tenant.orphanSeatPolicy as 'allow' | 'warn' | 'block',
      });
      if (rules.errors.length) throw Errors.seatRules(rules.errors);

      const rows = await this.lockSeats(tx, screeningId, seatIds);
      if (rows.length !== seatIds.length) throw Errors.validation('Unknown seat in request');
      const conflicts = rows.filter((r) => !this.isTakeable(r, previous?.id ?? null, now)).map((r) => r.seatId);
      if (conflicts.length) throw Errors.seatsUnavailable(conflicts);

      const released: string[] = [];
      if (previous) {
        const keep = new Set(seatIds);
        const drop = previous.seatIds.filter((s) => !keep.has(s));
        if (drop.length) {
          await tx.screeningSeat.updateMany({ where: { screeningId, seatId: { in: drop }, holdId: previous.id, state: 'HELD' }, data: { state: 'AVAILABLE', holdId: null, heldUntil: null, version: { increment: 1 } } });
          released.push(...drop);
        }
        await tx.seatHold.update({ where: { id: previous.id }, data: { status: 'RELEASED' } });
      }

      // Replacing seats keeps the original expiry so a hold cannot be extended indefinitely.
      const expiresAt = previous && previous.expiresAt > now ? previous.expiresAt : new Date(now.getTime() + tenant.holdDurationSeconds * 1000);
      const hold = await tx.seatHold.create({ data: { tenantId: tenant.id, screeningId, customerId, seatIds, expiresAt, status: 'ACTIVE', createdAt: now } });
      const updated = await tx.screeningSeat.updateMany({
        where: { screeningId, seatId: { in: seatIds } },
        data: { state: 'HELD', holdId: hold.id, heldUntil: expiresAt, version: { increment: 1 } },
      });
      if (updated.count !== seatIds.length) throw Errors.seatsUnavailable(seatIds);
      return { hold, released, warnings: rules.warnings };
    });

    this.events.publish({
      screeningId,
      changes: [...result.released.map((seatId) => ({ seatId, state: 'available' as const })), ...seatIds.map((seatId) => ({ seatId, state: 'held' as const }))],
    });
    return this.toDto(result.hold, result.warnings);
  }

  async get(tenantId: string, customerId: string, holdId: string): Promise<HoldDto> {
    const h = await this.prisma.seatHold.findFirst({ where: { id: holdId, tenantId, customerId } });
    if (!h) throw Errors.notFound('Reservation');
    if (h.status === 'ACTIVE' && h.expiresAt <= this.clock.now()) return this.toDto({ ...h, status: 'EXPIRED' });
    return this.toDto(h);
  }

  async release(tenantId: string, customerId: string, holdId: string): Promise<void> {
    const seats = await this.prisma.$transaction(async (tx) => {
      const h = await tx.seatHold.findFirst({ where: { id: holdId, tenantId, customerId } });
      if (!h) throw Errors.notFound('Reservation');
      if (h.status !== 'ACTIVE') return { screeningId: h.screeningId, seatIds: [] as string[] };
      await tx.seatHold.update({ where: { id: h.id }, data: { status: 'RELEASED' } });
      await tx.screeningSeat.updateMany({ where: { holdId: h.id, state: 'HELD' }, data: { state: 'AVAILABLE', holdId: null, heldUntil: null, version: { increment: 1 } } });
      return { screeningId: h.screeningId, seatIds: h.seatIds };
    });
    this.events.publish({ screeningId: seats.screeningId, changes: seats.seatIds.map((seatId) => ({ seatId, state: 'available' as const })) });
  }

  /** Background sweep. Reads already treat expired holds as available; this tidies state and notifies clients. */
  @Interval(15_000)
  async sweepExpired(): Promise<number> {
    const now = this.clock.now();
    const expired = await this.prisma.seatHold.findMany({ where: { status: 'ACTIVE', expiresAt: { lte: now } }, take: 500 });
    for (const h of expired) {
      const changed = await this.prisma.$transaction(async (tx) => {
        const res = await tx.seatHold.updateMany({ where: { id: h.id, status: 'ACTIVE' }, data: { status: 'EXPIRED' } });
        if (!res.count) return [];
        const seats = await tx.screeningSeat.findMany({ where: { holdId: h.id, state: 'HELD' }, select: { seatId: true } });
        await tx.screeningSeat.updateMany({ where: { holdId: h.id, state: 'HELD' }, data: { state: 'AVAILABLE', holdId: null, heldUntil: null, version: { increment: 1 } } });
        return seats.map((s) => s.seatId);
      });
      if (changed.length) this.events.publish({ screeningId: h.screeningId, changes: changed.map((seatId) => ({ seatId, state: 'available' as const })) });
    }
    if (expired.length) this.log.log(`Expired ${expired.length} holds`);
    return expired.length;
  }
}
