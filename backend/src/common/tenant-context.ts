import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AdminRole, Tenant } from '@prisma/client';
import { Errors } from './errors';
import { PrismaService } from './prisma.service';
import { AdminClaims, verifyToken } from './tokens';

/**
 * Tenant isolation: every tenant-scoped route has a `:tenant` slug param.
 * TenantGuard resolves it once per request; services receive the tenant id
 * and must always filter by it.
 */

export interface TenantRequest {
  params: Record<string, string>;
  headers: Record<string, string | undefined>;
  tenant?: Tenant;
  customerId?: string;
  admin?: AdminClaims;
}

@Injectable()
export class TenantCache {
  private cache = new Map<string, { tenant: Tenant; at: number }>();
  constructor(private readonly prisma: PrismaService) {}

  async bySlug(slug: string): Promise<Tenant> {
    const hit = this.cache.get(slug);
    if (hit && Date.now() - hit.at < 30_000) return hit.tenant;
    const tenant = await this.prisma.tenant.findUnique({ where: { slug } });
    if (!tenant) throw Errors.notFound('Operator');
    this.cache.set(slug, { tenant, at: Date.now() });
    return tenant;
  }

  invalidate(slug?: string) {
    if (slug) this.cache.delete(slug);
    else this.cache.clear();
  }
}

@Injectable()
export class TenantGuard implements CanActivate {
  constructor(private readonly tenants: TenantCache) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    const slug = req.params.tenant;
    if (!slug) return true;
    req.tenant = await this.tenants.bySlug(slug);
    return true;
  }
}

function bearer(req: TenantRequest): string | null {
  const h = req.headers['authorization'];
  if (!h || !h.startsWith('Bearer ')) return null;
  return h.slice(7);
}

/** Requires a customer token issued for the same tenant. */
@Injectable()
export class CustomerGuard implements CanActivate {
  constructor(private readonly tenants: TenantCache) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    if (!req.tenant && req.params.tenant) req.tenant = await this.tenants.bySlug(req.params.tenant);
    const token = bearer(req);
    const claims = token ? verifyToken(token) : null;
    if (!claims || claims.typ !== 'customer') throw Errors.unauthorised();
    if (!req.tenant || claims.tid !== req.tenant.id) throw Errors.forbidden();
    req.customerId = claims.sub;
    return true;
  }
}

/** Attaches the customer id if a valid token is present, otherwise continues anonymously. */
@Injectable()
export class OptionalCustomerGuard implements CanActivate {
  constructor(private readonly tenants: TenantCache) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    if (!req.tenant && req.params.tenant) req.tenant = await this.tenants.bySlug(req.params.tenant);
    const token = bearer(req);
    const claims = token ? verifyToken(token) : null;
    if (claims?.typ === 'customer' && req.tenant && claims.tid === req.tenant.id) req.customerId = claims.sub;
    return true;
  }
}

export const ROLES_KEY = 'roles';
export const Roles = (...roles: AdminRole[]) => SetMetadata(ROLES_KEY, roles);

/**
 * Admin authorisation. Platform admins can act on any tenant; everyone else
 * only on their own tenant and only with an allowed role.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector, private readonly tenants: TenantCache) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<TenantRequest>();
    const token = bearer(req);
    const claims = token ? verifyToken(token) : null;
    if (!claims || claims.typ !== 'admin') throw Errors.unauthorised();
    req.admin = claims;
    const allowed = this.reflector.getAllAndOverride<AdminRole[] | undefined>(ROLES_KEY, [ctx.getHandler(), ctx.getClass()]);
    const isPlatform = claims.role === 'PLATFORM_ADMIN';
    if (allowed && !isPlatform && !allowed.includes(claims.role as AdminRole)) throw Errors.forbidden();
    if (req.params.tenant) {
      req.tenant = await this.tenants.bySlug(req.params.tenant);
      if (!isPlatform && claims.tid !== req.tenant.id) throw Errors.forbidden();
    }
    return true;
  }
}

export const CurrentTenant = createParamDecorator((_: unknown, ctx: ExecutionContext): Tenant => {
  const req = ctx.switchToHttp().getRequest<TenantRequest>();
  if (!req.tenant) throw Errors.notFound('Operator');
  return req.tenant;
});

export const CustomerId = createParamDecorator((_: unknown, ctx: ExecutionContext): string | undefined => {
  return ctx.switchToHttp().getRequest<TenantRequest>().customerId;
});

export const CurrentAdmin = createParamDecorator((_: unknown, ctx: ExecutionContext): AdminClaims => {
  const admin = ctx.switchToHttp().getRequest<TenantRequest>().admin;
  if (!admin) throw Errors.unauthorised();
  return admin;
});
