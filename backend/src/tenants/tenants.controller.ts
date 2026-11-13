import { BadRequestException, Controller, Get, Headers, HttpCode, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { appStatus, AppVersionString } from '@cinema/contracts';
import { FLEET_BRANDS, FLEET_POLICY } from '../fleet/fleet.data';
import { Tenant } from '@prisma/client';
import type { Response } from 'express';
import { PrismaService } from '../common/prisma.service';
import { CurrentTenant, TenantGuard } from '../common/tenant-context';
import { signToken } from '../common/tokens';
import { ConfigService } from './config.service';

@ApiTags('Tenant')
@Controller('v1/t/:tenant')
@UseGuards(TenantGuard)
export class TenantsController {
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService) {}

  @Get('config')
  @ApiOperation({ summary: 'Published, validated tenant configuration (supports If-None-Match)' })
  async getConfig(@CurrentTenant() tenant: Tenant, @Headers('if-none-match') inm: string | undefined, @Res({ passthrough: true }) res: Response) {
    const cfg = await this.config.current(tenant.id);
    const etag = `"cfg-${tenant.slug}-${cfg.version}"`;
    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');
    if (inm === etag) {
      res.status(304);
      return;
    }
    return cfg;
  }

  /**
   * Whether this app version is current, can update or must update. The fleet policy lives in
   * fleet/policy.json, so raising the minimum version for every app is one reviewed change.
   */
  @Get('app-status')
  @ApiOperation({ summary: 'Update status for an app version: current, update-available or update-required' })
  @ApiQuery({ name: 'platform', enum: ['ios'] })
  @ApiQuery({ name: 'version', description: 'The app version, e.g. 1.4.0' })
  appStatus(@CurrentTenant() tenant: Tenant, @Query('platform') platform: string, @Query('version') version: string, @Res({ passthrough: true }) res: Response) {
    if (platform !== 'ios') throw new BadRequestException('platform must be ios');
    if (!AppVersionString.safeParse(version).success) throw new BadRequestException('version must look like 1.4.0');
    // Short cache: a raised minimum reaches every app within five minutes.
    res.setHeader('Cache-Control', 'public, max-age=300');
    return appStatus(FLEET_POLICY, FLEET_BRANDS.find((b) => b.slug === tenant.slug) ?? null, version);
  }

  @Post('auth/guest')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a guest customer session. Registration is only needed for account features.' })
  async guest(@CurrentTenant() tenant: Tenant) {
    const customer = await this.prisma.customer.create({ data: { tenantId: tenant.id, kind: 'GUEST' } });
    const token = signToken({ typ: 'customer', sub: customer.id, tid: tenant.id }, 60 * 60 * 24 * 90);
    return { token, customerId: customer.id, kind: customer.kind };
  }
}
