import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';

export function configureApp(app: INestApplication) {
  app.use(json({ limit: '15mb' }));
  app.enableCors({ origin: (process.env.ADMIN_ORIGINS ?? 'http://localhost:3001').split(','), credentials: false });
  app.enableShutdownHooks();
}

export function openApiDocument(app: INestApplication) {
  const config = new DocumentBuilder()
    .setTitle('Cinema Platform API')
    .setDescription('White-label cinema booking platform. Customer routes are under /v1/t/{tenant}; operator routes under /v1/admin.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .build();
  return SwaggerModule.createDocument(app, config);
}
