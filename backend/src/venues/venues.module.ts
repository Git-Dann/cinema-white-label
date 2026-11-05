import { Controller, Delete, Get, HttpCode, Module, Param, Put, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Tenant, Venue } from '@prisma/client';
import { Errors } from '../common/errors';
import { venueFeatures } from '../commerce/commerce.service';
import { PrismaService } from '../common/prisma.service';
import { CurrentTenant, CustomerGuard, CustomerId, OptionalCustomerGuard, TenantGuard } from '../common/tenant-context';

function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function venueDto(v: Venue & { auditoriums?: { id: string }[] }, extra: { isFavourite?: boolean; distanceKm?: number | null } = {}) {
  return {
    id: v.id,
    slug: v.slug,
    name: v.name,
    address: { line1: v.addressLine1, city: v.city, postcode: v.postcode },
    coordinate: { latitude: v.latitude, longitude: v.longitude },
    timeZone: v.timeZone,
    phone: v.phone,
    facilities: v.facilities,
    features: venueFeatures(v),
    screenCount: v.auditoriums?.length ?? null,
    isFavourite: extra.isFavourite ?? false,
    distanceKm: extra.distanceKm ?? null,
  };
}

@ApiTags('Venues')
@Controller('v1/t/:tenant')
@UseGuards(TenantGuard)
export class VenuesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('venues')
  @UseGuards(OptionalCustomerGuard)
  @ApiQuery({ name: 'lat', required: false })
  @ApiQuery({ name: 'lng', required: false })
  @ApiQuery({ name: 'q', required: false, description: 'Name, city or postcode search' })
  async list(@CurrentTenant() tenant: Tenant, @CustomerId() customerId?: string, @Query('lat') lat?: string, @Query('lng') lng?: string, @Query('q') q?: string) {
    const venues = await this.prisma.venue.findMany({
      where: {
        tenantId: tenant.id,
        ...(q ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { city: { contains: q, mode: 'insensitive' } }, { postcode: { startsWith: q.toUpperCase().split(' ')[0] } }] } : {}),
      },
      include: { auditoriums: { select: { id: true } } },
      orderBy: { name: 'asc' },
    });
    const favs = customerId ? new Set((await this.prisma.favouriteVenue.findMany({ where: { customerId } })).map((f) => f.venueId)) : new Set<string>();
    const la = lat ? Number(lat) : NaN;
    const lo = lng ? Number(lng) : NaN;
    const hasLoc = Number.isFinite(la) && Number.isFinite(lo);
    const out = venues.map((v) => venueDto(v, { isFavourite: favs.has(v.id), distanceKm: hasLoc ? Math.round(distanceKm(la, lo, v.latitude, v.longitude) * 10) / 10 : null }));
    if (hasLoc) out.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0));
    return out;
  }

  @Get('venues/:venueId')
  @UseGuards(OptionalCustomerGuard)
  async get(@CurrentTenant() tenant: Tenant, @Param('venueId') venueId: string, @CustomerId() customerId?: string) {
    const v = await this.prisma.venue.findFirst({ where: { tenantId: tenant.id, OR: [{ id: venueId }, { slug: venueId }] }, include: { auditoriums: { select: { id: true } } } });
    if (!v) throw Errors.notFound('Cinema');
    const fav = customerId ? !!(await this.prisma.favouriteVenue.findUnique({ where: { customerId_venueId: { customerId, venueId: v.id } } })) : false;
    return venueDto(v, { isFavourite: fav });
  }

  @Put('me/favourites/:venueId')
  @HttpCode(204)
  @ApiBearerAuth()
  @UseGuards(CustomerGuard)
  async favourite(@CurrentTenant() tenant: Tenant, @CustomerId() customerId: string, @Param('venueId') venueId: string) {
    const v = await this.prisma.venue.findFirst({ where: { id: venueId, tenantId: tenant.id } });
    if (!v) throw Errors.notFound('Cinema');
    await this.prisma.favouriteVenue.upsert({ where: { customerId_venueId: { customerId, venueId } }, create: { customerId, venueId }, update: {} });
  }

  @Delete('me/favourites/:venueId')
  @HttpCode(204)
  @ApiBearerAuth()
  @UseGuards(CustomerGuard)
  async unfavourite(@CustomerId() customerId: string, @Param('venueId') venueId: string) {
    await this.prisma.favouriteVenue.deleteMany({ where: { customerId, venueId } });
  }
}

@Module({ controllers: [VenuesController] })
export class VenuesModule {}
