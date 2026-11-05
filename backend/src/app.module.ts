import { Module } from '@nestjs/common';
import { PromotionsModule } from './promotions/promotions.module';
import { ScheduleModule } from '@nestjs/schedule';
import { AdminModule } from './admin/admin.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { BookingModule } from './bookings/booking.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { CommonModule } from './common/common.module';
import { HealthController } from './health.controller';
import { MediaModule } from './media/media.module';
import { TenantsModule } from './tenants/tenants.module';
import { VenuesModule } from './venues/venues.module';

@Module({
  imports: [ScheduleModule.forRoot(), CommonModule, TenantsModule, CatalogueModule, MediaModule, VenuesModule, BookingModule, AnalyticsModule, AdminModule, PromotionsModule],
  controllers: [HealthController],
})
export class AppModule {}
