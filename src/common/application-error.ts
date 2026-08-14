import { ServiceUnavailableException } from '@nestjs/common';

export type ApplicationFailureCode =
  | 'OPENAI_REQUEST_FAILED'
  | 'OPENAI_EMPTY_RESPONSE'
  | 'OPENAI_EMBEDDING_FAILED'
  | 'DATABASE_UNAVAILABLE';

export abstract class ApplicationServiceUnavailableException extends ServiceUnavailableException {
  constructor(
    readonly failureCode: ApplicationFailureCode,
    userMessage: string,
  ) {
    super(userMessage);
  }
}

export class OpenAiRequestFailedException extends ApplicationServiceUnavailableException {
  constructor() {
    super(
      'OPENAI_REQUEST_FAILED',
      'El asistente no está disponible en este momento. Inténtalo nuevamente.',
    );
  }
}

export class OpenAiEmptyResponseException extends ApplicationServiceUnavailableException {
  constructor() {
    super(
      'OPENAI_EMPTY_RESPONSE',
      'El asistente no está disponible en este momento. Inténtalo nuevamente.',
    );
  }
}

export class OpenAiEmbeddingFailedException extends ApplicationServiceUnavailableException {
  constructor() {
    super(
      'OPENAI_EMBEDDING_FAILED',
      'La búsqueda de conocimiento no está disponible en este momento.',
    );
  }
}

export class DatabaseUnavailableException extends ApplicationServiceUnavailableException {
  constructor() {
    super(
      'DATABASE_UNAVAILABLE',
      'No puedo consultar la información del negocio en este momento. Inténtalo nuevamente.',
    );
  }
}

export function getApplicationFailureCode(error: unknown): ApplicationFailureCode | undefined {
  return error instanceof ApplicationServiceUnavailableException ? error.failureCode : undefined;
}
