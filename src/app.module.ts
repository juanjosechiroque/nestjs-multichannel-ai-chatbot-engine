import { Module } from '@nestjs/common';
import { ConditionalModule, ConfigModule } from '@nestjs/config';
import { WebChannelModule } from './channels/web/web-channel.module';
import { WhatsAppChannelModule } from './channels/whatsapp/whatsapp-channel.module';
import { loadBusinessConfig } from './config/business.config';
import { validateEnvironment } from './config/environment';
import { isWhatsAppEnabled } from './config/whatsapp-enabled';
import { HealthModule } from './health/health.module';
import { DatabaseModule } from './database/database.module';
import { CatalogModule } from './catalog/catalog.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnvironment,
      load: [loadBusinessConfig],
    }),
    DatabaseModule,
    CatalogModule,
    HealthModule,
    WebChannelModule,
    // WhatsApp is an optional adapter. The decision happens once, here at the
    // composition boundary: enabled -> the whole module is imported; disabled ->
    // it is not part of the application, so `MetaWhatsAppClient` is never built
    // and `/api/webhook/whatsapp` is never registered. `ConditionalModule` waits
    // for `ConfigModule` to load `.env` before evaluating the flag.
    ConditionalModule.registerWhen(WhatsAppChannelModule, (env: NodeJS.ProcessEnv) =>
      isWhatsAppEnabled(env),
    ),
  ],
})
export class AppModule {}
