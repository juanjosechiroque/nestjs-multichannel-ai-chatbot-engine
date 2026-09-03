import { Module, type DynamicModule } from '@nestjs/common';
import { ConditionalModule, ConfigModule } from '@nestjs/config';
import { isWhatsAppEnabled } from './config/whatsapp-enabled';

// A stand-in for `WhatsAppChannelModule`: this spec verifies the composition
// mechanism `AppModule` uses (`ConditionalModule.registerWhen` + the shared
// `isWhatsAppEnabled` predicate), not the WhatsApp module's own wiring, which
// the E2E suites cover end to end.
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
    // `ConditionalModule.registerWhen` waits for `ConfigModule` to signal that
    // environment variables are loaded before it evaluates the predicate.
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
