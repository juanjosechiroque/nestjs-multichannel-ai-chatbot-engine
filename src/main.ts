import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './app.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { rawBody: true });
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);
  const corsAllowedOrigins = config.getOrThrow<string[]>('CORS_ALLOWED_ORIGINS');

  configureApplication(app, { corsAllowedOrigins });

  await app.listen(port);
  Logger.log(`Server running at http://localhost:${port}`, 'Bootstrap');
  Logger.log(`Swagger UI available at http://localhost:${port}/api/docs`, 'Bootstrap');
}

void bootstrap();
