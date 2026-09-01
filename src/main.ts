import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApplication } from './app.setup';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  app.enableShutdownHooks();
  const config = app.get(ConfigService);
  const port = config.get<number>('PORT', 3000);

  configureApplication(app);

  await app.listen(port);
  Logger.log(`Server running at http://localhost:${port}`, 'Bootstrap');
  Logger.log(`Swagger UI available at http://localhost:${port}/api/docs`, 'Bootstrap');
}

void bootstrap();
