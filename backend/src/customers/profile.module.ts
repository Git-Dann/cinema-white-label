import { Body, Controller, Delete, Get, HttpCode, Module, Put, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomerProfile, CustomerProfileInput } from '@cinema/contracts';
import { Customer, Tenant } from '@prisma/client';
import { Clock } from '../common/clock';
import { PrismaService } from '../common/prisma.service';
import { CurrentTenant, CustomerGuard, CustomerId, TenantGuard } from '../common/tenant-context';
import { ZodPipe } from '../common/zod.pipe';

const view = (c: Customer): CustomerProfile => ({
  givenName: c.givenName,
  familyName: c.familyName,
  email: c.email,
  phone: c.phone,
  marketingOptIn: c.marketingOptIn,
  updatedAt: c.profileUpdatedAt?.toISOString() ?? null,
});

/**
 * The customer's own details, edited from Account in the app. Scoped to the signed-in customer
 * of this operator: the customer id comes from the token, never the request body.
 */
@ApiTags('Customer profile')
@ApiBearerAuth()
@Controller('v1/t/:tenant/me/profile')
@UseGuards(TenantGuard, CustomerGuard)
export class CustomerProfileController {
  constructor(private readonly prisma: PrismaService, private readonly clock: Clock) {}

  private customer(t: Tenant, id: string) {
    return this.prisma.customer.findFirstOrThrow({ where: { id, tenantId: t.id } });
  }

  @Get()
  @ApiOperation({ summary: 'Your details' })
  async get(@CurrentTenant() t: Tenant, @CustomerId() id: string) {
    return view(await this.customer(t, id));
  }

  @Put()
  @ApiOperation({ summary: 'Save your details (all fields, any can be empty)' })
  async put(@CurrentTenant() t: Tenant, @CustomerId() id: string, @Body(new ZodPipe(CustomerProfileInput)) p: CustomerProfileInput) {
    const before = await this.customer(t, id);
    const now = this.clock.now();
    const displayName = [p.givenName, p.familyName].filter(Boolean).join(' ') || null;
    const saved = await this.prisma.customer.update({
      where: { id: before.id },
      data: {
        givenName: p.givenName,
        familyName: p.familyName,
        displayName,
        email: p.email,
        phone: p.phone,
        marketingOptIn: p.marketingOptIn,
        // Record when consent was given; keep the date of the last opt-in after opting out.
        marketingConsentAt: p.marketingOptIn && !before.marketingOptIn ? now : before.marketingConsentAt,
        profileUpdatedAt: now,
      },
    });
    return view(saved);
  }

  /** Clears everything the customer told us. Bookings and points stay. */
  @Delete()
  @HttpCode(200)
  @ApiOperation({ summary: 'Remove your details' })
  async remove(@CurrentTenant() t: Tenant, @CustomerId() id: string) {
    await this.customer(t, id);
    const saved = await this.prisma.customer.update({
      where: { id },
      data: { givenName: null, familyName: null, displayName: null, email: null, phone: null, marketingOptIn: false, profileUpdatedAt: this.clock.now() },
    });
    return view(saved);
  }
}

@Module({ controllers: [CustomerProfileController] })
export class CustomerProfileModule {}
