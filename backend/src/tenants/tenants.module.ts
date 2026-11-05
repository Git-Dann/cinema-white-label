import { Module } from '@nestjs/common';
import { ConfigService } from './config.service';
import { TenantsController } from './tenants.controller';

@Module({ controllers: [TenantsController], providers: [ConfigService], exports: [ConfigService] })
export class TenantsModule {}
