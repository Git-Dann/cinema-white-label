// Vercel serverless entry. Runs the compiled Nest app from dist/ (built with tsc,
// which keeps the decorator metadata Nest's dependency injection needs) and reuses
// it across requests while the instance is warm.
require('reflect-metadata');
const { NestFactory } = require('@nestjs/core');
const { SwaggerModule } = require('@nestjs/swagger');
const { AppModule } = require('../dist/app.module');
const { configureApp, docsOptions, openApiDocument } = require('../dist/bootstrap');

let ready;

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false, logger: ['error', 'warn'] });
  configureApp(app);
  SwaggerModule.setup('docs', app, openApiDocument(app), docsOptions);
  await app.init();
  return app.getHttpAdapter().getInstance();
}

module.exports = async (req, res) => {
  ready ??= bootstrap().catch((e) => {
    ready = undefined;
    throw e;
  });
  const handler = await ready;
  return handler(req, res);
};
