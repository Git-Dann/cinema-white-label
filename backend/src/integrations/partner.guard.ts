import { CanActivate, ExecutionContext, Injectable, SetMetadata } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Clock } from '../common/clock';
import { Errors } from '../common/errors';
import { PrismaService } from '../common/prisma.service';
import { TenantRequest } from '../common/tenant-context';
import { hashKey } from './keys';
import { Scope } from './scopes';

export const SCOPES_KEY = 'partnerScopes';
/** The scope a partner key needs for this endpoint. */
export const RequireScope = (scope: Scope) => SetMetadata(SCOPES_KEY, scope);

/**
 * Partner API authentication: "Authorization: Bearer sf_live_…". The key decides the
 * operator (never a URL or body field) and must carry the endpoint's scope.
 */
@Injectable()
export class PartnerGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly prisma: PrismaService, private readonly clock: Clock) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<TenantRequest & { partnerKeyId?: string }>();
    const h = req.headers['authorization'];
    const key = typeof h === 'string' && h.startsWith('Bearer sf_live_') ? h.slice(7) : null;
    if (!key) throw Errors.unauthorised();
    const row = await this.prisma.apiKey.findUnique({ where: { keyHash: hashKey(key) }, include: { tenant: true } });
    if (!row || row.revokedAt) throw Errors.unauthorised();
    const needed = this.reflector.getAllAndOverride<Scope | undefined>(SCOPES_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (!needed || !row.scopes.includes(needed)) throw Errors.forbidden();
    req.tenant = row.tenant;
    req.partnerKeyId = row.id;
    // Record use at most once a minute, so busy keys don't write on every call.
    const now = this.clock.now();
    if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > 60_000) {
      await this.prisma.apiKey.update({ where: { id: row.id }, data: { lastUsedAt: now } });
    }
    return true;
  }
}
