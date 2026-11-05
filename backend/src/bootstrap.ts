import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';

export function configureApp(app: INestApplication) {
  app.use(json({ limit: '15mb' }));
  app.enableCors({ origin: corsOrigins(process.env.ADMIN_ORIGINS), credentials: false });
  // Serverless platforms (Vercel) freeze and recycle instances themselves.
  if (!process.env.VERCEL) app.enableShutdownHooks();
}

/**
 * Allowed portal origins, comma-separated. Entries starting with "*." match any
 * subdomain (e.g. "*.vercel.app" for preview deployments). The portal uses bearer
 * tokens, not cookies, so a wider origin list does not expose sessions.
 */
export function corsOrigins(setting = 'http://localhost:3001') {
  // Tolerate values pasted with quotes or spaces (e.g. "*.vercel.app" typed into a dashboard).
  const entries = setting
    .split(',')
    .map((s) => s.trim().replace(/^['"]+|['"]+$/g, '').trim().replace(/\/$/, '').replace(/^https:\/\/\*\./, '*.'))
    .filter(Boolean);
  return (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
    if (!origin) return cb(null, true);
    let host = '';
    try {
      host = new URL(origin).host;
    } catch {
      return cb(null, false);
    }
    const ok = entries.some((e) => (e.startsWith('*.') ? host.endsWith(e.slice(1)) && new URL(origin).protocol === 'https:' : e === origin));
    cb(null, ok);
  };
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
