import { Module } from '@nestjs/common';
import { IntegrationsAdminController } from './integrations-admin.controller';
import { PartnerController } from './partner.controller';
import { PartnerGuard } from './partner.guard';
import { WebhookService } from './webhooks.service';

@Module({
  controllers: [PartnerController, IntegrationsAdminController],
  providers: [WebhookService, PartnerGuard],
  exports: [WebhookService],
})
export class IntegrationsModule {}
