import { Logger } from '@nestjs/common';

// Silences NestJS Logger output and fails any test that writes to
// console.error/console.warn without spying on it first.

type LoggerLevel = 'log' | 'error' | 'warn' | 'debug' | 'verbose' | 'fatal';

const LOGGER_LEVELS: readonly LoggerLevel[] = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'];

function silenceNestLogger(): void {
  for (const level of LOGGER_LEVELS) {
    if (typeof Logger.prototype[level] === 'function') {
      jest
        .spyOn(Logger.prototype, level)
        .mockImplementation(() => undefined)
        .mockClear();
    }
  }
}

const GUARDED_CONSOLE_METHODS = ['error', 'warn'] as const;
type GuardedConsoleMethod = (typeof GUARDED_CONSOLE_METHODS)[number];

const realConsole: Record<GuardedConsoleMethod, (...args: unknown[]) => void> = {
  error: console.error.bind(console),
  warn: console.warn.bind(console),
};

let strayConsoleCalls: Array<{ method: GuardedConsoleMethod; text: string }> = [];

for (const method of GUARDED_CONSOLE_METHODS) {
  console[method] = (...args: unknown[]): void => {
    strayConsoleCalls.push({
      method,
      text: args
        .map((argument) =>
          argument instanceof Error ? (argument.stack ?? argument.message) : String(argument),
        )
        .join(' '),
    });
  };
}

beforeAll(silenceNestLogger);

beforeEach(() => {
  silenceNestLogger();
  strayConsoleCalls = [];
});

afterEach(() => {
  if (strayConsoleCalls.length === 0) {
    return;
  }

  const details = strayConsoleCalls
    .map(({ method, text }) => `  console.${method}: ${text.split('\n')[0]}`)
    .join('\n');
  strayConsoleCalls = [];

  throw new Error(
    `Unexpected console output during this test:\n${details}\n` +
      'Route diagnostics through the NestJS Logger, or spy on console explicitly if the ' +
      'call is expected.',
  );
});

afterAll(() => {
  for (const method of GUARDED_CONSOLE_METHODS) {
    console[method] = realConsole[method];
  }
});
