import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { configureApp, docsOptions, openApiDocument } from './bootstrap';

async function main() {
  if (!process.env.AUTH_SECRET) require('fs').existsSync('.env') && process.loadEnvFile?.('.env');
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  configureApp(app);
  SwaggerModule.setup('docs', app, openApiDocument(app), docsOptions);
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port, '0.0.0.0');
  console.log(`API listening on http://localhost:${port} (OpenAPI at /docs)`);
}
main();
