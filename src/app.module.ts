import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { cafeNubeMenuDocument } from '../examples/cafe-nube/cafe-nube.config';
import { WebChannelModule } from './channels/web/web-channel.module';
import { validateEnvironment } from './config/environment';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './database/database.module';
import { CatalogModule } from './catalog/catalog.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
      load: [() => ({ catalogDocument: cafeNubeMenuDocument })],
    }),
    DatabaseModule,
    CatalogModule,
    HealthModule,
    WebChannelModule,
  ],
})
export class AppModule {}
