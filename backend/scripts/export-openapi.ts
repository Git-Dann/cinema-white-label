import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { AppModule } from '../src/app.module';
import { openApiDocument } from '../src/bootstrap';

async function main() {
  process.loadEnvFile?.(join(__dirname, '../.env'));
  const app = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  const doc = openApiDocument(app);
  const out = join(__dirname, '../../shared/openapi/openapi.json');
  require('fs').mkdirSync(join(out, '..'), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  await app.close();
  console.log(`Wrote ${Object.keys(doc.paths).length} paths to ${out}`);
}
main();
