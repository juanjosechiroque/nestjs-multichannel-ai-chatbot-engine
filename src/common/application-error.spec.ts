import {
  DatabaseUnavailableException,
  getApplicationFailureCode,
  OpenAiEmbeddingFailedException,
  OpenAiEmptyResponseException,
  OpenAiIncompleteResponseException,
  OpenAiRequestFailedException,
  WhatsAppDeliveryFailedException,
} from './application-error';

describe('application errors', () => {
  it.each([
    [new OpenAiRequestFailedException(), 'OPENAI_REQUEST_FAILED'],
    [new OpenAiIncompleteResponseException('max_output_tokens'), 'OPENAI_INCOMPLETE_RESPONSE'],
    [new OpenAiEmptyResponseException(), 'OPENAI_EMPTY_RESPONSE'],
    [new OpenAiEmbeddingFailedException(), 'OPENAI_EMBEDDING_FAILED'],
    [new DatabaseUnavailableException(), 'DATABASE_UNAVAILABLE'],
    [new WhatsAppDeliveryFailedException(), 'WHATSAPP_DELIVERY_FAILED'],
  ])('exposes an internal failure code for %s', (error, expectedCode) => {
    expect(error.getStatus()).toBe(503);
    expect(getApplicationFailureCode(error)).toBe(expectedCode);
  });

  it('does not classify unknown errors', () => {
    expect(getApplicationFailureCode(new Error('unknown'))).toBeUndefined();
  });
});
