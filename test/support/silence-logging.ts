import { Logger } from '@nestjs/common';

// Silences NestJS Logger output in every test: the suite deliberately exercises
// error/warn paths and should not spew them into the reporter. Specs that assert
// on structured logging re-spy on Logger.prototype themselves.

const LOGGER_LEVELS = ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'] as const;

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

beforeAll(silenceNestLogger);
beforeEach(silenceNestLogger);
