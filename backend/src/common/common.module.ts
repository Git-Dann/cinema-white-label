import { Global, Injectable, Module } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Clock } from './clock';
import { IdempotencyService } from './idempotency.service';
import { PrismaService } from './prisma.service';
import { AdminGuard, CustomerGuard, OptionalCustomerGuard, TenantCache, TenantGuard } from './tenant-context';

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}
  record(entry: { tenantId?: string | null; actorId?: string | null; action: string; entityType: string; entityId?: string | null; data?: unknown }) {
    return this.prisma.auditLog.create({
      data: { ...entry, data: entry.data === undefined ? undefined : (JSON.parse(JSON.stringify(entry.data)) as Prisma.InputJsonValue) },
    });
  }
}

@Global()
@Module({
  providers: [PrismaService, Clock, IdempotencyService, TenantCache, TenantGuard, CustomerGuard, OptionalCustomerGuard, AdminGuard, AuditService],
  exports: [PrismaService, Clock, IdempotencyService, TenantCache, TenantGuard, CustomerGuard, OptionalCustomerGuard, AdminGuard, AuditService],
})
export class CommonModule {}
