import 'dotenv/config';
import 'reflect-metadata';
import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { AppConfig } from './config/configuration';
import { docsAuthMiddleware } from './common/docs-auth';
import { JsonLogger } from './common/logger/json-logger';
import { requestContextMiddleware } from './common/request-context';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    bodyParser: false,
    bufferLogs: true,
  });
  const logger = new JsonLogger();
  app.useLogger(logger);

  const config = app.get(ConfigService<AppConfig, true>);
  const docs = config.get('docs', { infer: true });

  app.use(requestContextMiddleware);
  app.use(docsAuthMiddleware(docs.user, docs.password));
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use(cookieParser());
  const bodyLimit = config.get('bodyLimit', { infer: true });
  app.useBodyParser('json', { limit: bodyLimit });
  app.useBodyParser('urlencoded', { extended: true, limit: bodyLimit });

  const origins = config.get('corsOrigins', { infer: true });
  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: true,
  });

  app.setGlobalPrefix('api/v1', {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
      { path: 'docs', method: RequestMethod.ALL },
      { path: 'docs-json', method: RequestMethod.ALL },
      { path: 'docs-yaml', method: RequestMethod.ALL },
    ],
  });

  if (docs.password) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('AfriBasket API')
        .setDescription(
          'US online grocery for African food. Money is integer USD cents. Errors use { error: { code, message, details } }. Lists return { items, page, perPage, total }.',
        )
        .setVersion('1.0.0')
        .addBearerAuth()
        .addServer('/api/v1')
        .build(),
    );
    SwaggerModule.setup('docs', app, document, {
      swaggerOptions: { persistAuthorization: true },
    });
  }

  app.enableShutdownHooks();
  const port = config.get('port', { infer: true });
  await app.listen(port);
  logger.log({ msg: 'listening', port });
}

void bootstrap();
