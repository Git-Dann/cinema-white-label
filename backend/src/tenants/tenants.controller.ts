import { Controller, Get, Headers, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
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

  @Post('auth/guest')
  @HttpCode(201)
  @ApiOperation({ summary: 'Create a guest customer session. Registration is only needed for account features.' })
  async guest(@CurrentTenant() tenant: Tenant) {
    const customer = await this.prisma.customer.create({ data: { tenantId: tenant.id, kind: 'GUEST' } });
    const token = signToken({ typ: 'customer', sub: customer.id, tid: tenant.id }, 60 * 60 * 24 * 90);
    return { token, customerId: customer.id, kind: customer.kind };
  }
}
