import { Module, type DynamicModule } from '@nestjs/common';
import { ConditionalModule, ConfigModule } from '@nestjs/config';
import { isWhatsAppEnabled } from './config/whatsapp-enabled';

// Module wiring is covered E2E; this isolates the conditional composition predicate.
@Module({})
class StubChannelModule {}

async function registerChannelWhen(enabledValue: string | undefined): Promise<DynamicModule> {
  const previous = process.env.WHATSAPP_ENABLED;
  if (enabledValue === undefined) {
    delete process.env.WHATSAPP_ENABLED;
  } else {
    process.env.WHATSAPP_ENABLED = enabledValue;
  }
  try {
    return await ConditionalModule.registerWhen(
      StubChannelModule,
      (env) => isWhatsAppEnabled(env),
      {
        debug: false,
      },
    );
  } finally {
    if (previous === undefined) {
      delete process.env.WHATSAPP_ENABLED;
    } else {
      process.env.WHATSAPP_ENABLED = previous;
    }
  }
}

describe('AppModule conditional WhatsApp composition', () => {
  beforeAll(async () => {
    await ConfigModule.forRoot({ ignoreEnvFile: true });
  });

  it('does not register the WhatsApp channel module when the flag is absent', async () => {
    const dynamicModule = await registerChannelWhen(undefined);

    expect(dynamicModule.imports ?? []).toEqual([]);
  });

  it('does not register the WhatsApp channel module when WHATSAPP_ENABLED=false', async () => {
    const dynamicModule = await registerChannelWhen('false');

    expect(dynamicModule.imports ?? []).toEqual([]);
  });

  it('registers the WhatsApp channel module when WHATSAPP_ENABLED=true', async () => {
    const dynamicModule = await registerChannelWhen('true');

    expect(dynamicModule.imports ?? []).toContain(StubChannelModule);
  });
});
