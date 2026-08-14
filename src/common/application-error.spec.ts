import {
  DatabaseUnavailableException,
  getApplicationFailureCode,
  OpenAiEmbeddingFailedException,
  OpenAiEmptyResponseException,
  OpenAiRequestFailedException,
} from './application-error';

describe('application errors', () => {
  it.each([
    [new OpenAiRequestFailedException(), 'OPENAI_REQUEST_FAILED'],
    [new OpenAiEmptyResponseException(), 'OPENAI_EMPTY_RESPONSE'],
    [new OpenAiEmbeddingFailedException(), 'OPENAI_EMBEDDING_FAILED'],
    [new DatabaseUnavailableException(), 'DATABASE_UNAVAILABLE'],
  ])('exposes an internal failure code for %s', (error, expectedCode) => {
    expect(error.getStatus()).toBe(503);
    expect(getApplicationFailureCode(error)).toBe(expectedCode);
  });

  it('does not classify unknown errors', () => {
    expect(getApplicationFailureCode(new Error('unknown'))).toBeUndefined();
  });
});
