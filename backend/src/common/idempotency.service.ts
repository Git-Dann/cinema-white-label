import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';
import { DomainError, Errors } from './errors';
import { PrismaService } from './prisma.service';

/**
 * Stores the outcome of mutating requests keyed by (tenant, scope, key) so a
 * client retry after a timeout replays the original response rather than
 * creating a second hold, booking or payment.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  async run<T>(tenantId: string, scope: string, key: string | undefined, request: unknown, work: () => Promise<T>): Promise<T> {
    if (!key) throw Errors.idempotencyRequired();
    const requestHash = createHash('sha256').update(JSON.stringify(request ?? null)).digest('hex');
    const existing = await this.prisma.idempotencyRecord.findUnique({ where: { tenantId_scope_key: { tenantId, scope, key } } });
    if (existing) {
      if (existing.requestHash !== requestHash) throw Errors.idempotencyMismatch();
      if (existing.responseStatus >= 400) {
        const body = existing.responseBody as { error: { code: string; message: string; details?: Record<string, unknown> } };
        throw new DomainError(existing.responseStatus, body.error.code, body.error.message, body.error.details);
      }
      return existing.responseBody as T;
    }

    let status = 200;
    let body: unknown;
    try {
      body = await work();
    } catch (e) {
      // Only deterministic business outcomes are cached; transient failures may be retried.
      if (e instanceof DomainError && !['payment_declined'].includes(e.code)) {
        status = e.getStatus();
        body = e.getResponse();
        await this.save(tenantId, scope, key, requestHash, status, body);
      }
      throw e;
    }
    await this.save(tenantId, scope, key, requestHash, status, body);
    return body as T;
  }

  private async save(tenantId: string, scope: string, key: string, requestHash: string, responseStatus: number, responseBody: unknown) {
    try {
      await this.prisma.idempotencyRecord.create({
        data: { tenantId, scope, key, requestHash, responseStatus, responseBody: JSON.parse(JSON.stringify(responseBody ?? null)) as Prisma.InputJsonValue },
      });
    } catch (e) {
      // A concurrent request with the same key won the race; its record stands.
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    }
  }
}
