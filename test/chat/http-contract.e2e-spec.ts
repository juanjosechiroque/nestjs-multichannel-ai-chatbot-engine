// Supertest uses a CommonJS `export =`, so an import assignment matches its runtime shape.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import { setupHttpE2E } from '../support/e2e-app';

interface OpenApiDocumentResponse {
  openapi: string;
  info: { title: string; version: string };
  paths: Record<string, Record<string, unknown>>;
  components?: { schemas?: Record<string, unknown> };
}

describe('HTTP contract and security headers', () => {
  const harness = setupHttpE2E();

  it('returns application health through the global API prefix', async () => {
    await request(harness.server).get('/api/health').expect(200, { status: 'ok' });
  });

  it('applies global security headers without exposing the Express signature', async () => {
    const response = await request(harness.server).get('/api/health').expect(200);

    expect(response.get('Content-Security-Policy')).toContain("default-src 'self'");
    expect(response.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.get('X-Content-Type-Options')).toBe('nosniff');
    expect(response.get('X-Frame-Options')).toBe('SAMEORIGIN');
    expect(response.get('X-Powered-By')).toBeUndefined();
  });

  it('allows the configured browser origin and omits CORS permission for another origin', async () => {
    const allowedResponse = await request(harness.server)
      .get('/api/health')
      .set('Origin', 'http://localhost:4173')
      .expect(200);
    const disallowedResponse = await request(harness.server)
      .get('/api/health')
      .set('Origin', 'https://untrusted.example')
      .expect(200);

    expect(allowedResponse.get('Access-Control-Allow-Origin')).toBe('http://localhost:4173');
    expect(disallowedResponse.get('Access-Control-Allow-Origin')).toBeUndefined();
  });

  it('answers preflight only with permission for the configured browser origin', async () => {
    const allowedResponse = await request(harness.server)
      .options('/api/chat')
      .set('Origin', 'http://localhost:4173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);
    const disallowedResponse = await request(harness.server)
      .options('/api/chat')
      .set('Origin', 'https://untrusted.example')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type')
      .expect(204);

    expect(allowedResponse.get('Access-Control-Allow-Origin')).toBe('http://localhost:4173');
    expect(allowedResponse.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(allowedResponse.get('Access-Control-Allow-Headers')).toBe('content-type');
    expect(disallowedResponse.get('Access-Control-Allow-Origin')).toBeUndefined();
  });

  it('publishes the documented HTTP contract as OpenAPI JSON', async () => {
    const swaggerResponse = await request(harness.server)
      .get('/api/docs')
      .expect('Content-Type', /html/)
      .expect(200);
    expect(swaggerResponse.get('Content-Security-Policy')).toContain(
      "script-src 'self' 'unsafe-inline'",
    );
    const response = await request(harness.server).get('/api/docs-json').expect(200);
    const document = response.body as OpenApiDocumentResponse;

    expect(document.openapi).toMatch(/^3\./);
    expect(document.info).toEqual(
      expect.objectContaining({
        title: 'Multichannel AI Chatbot Engine API',
        version: '0.1.0',
      }),
    );
    expect(Object.keys(document.paths)).toEqual(
      expect.arrayContaining([
        '/api/health',
        '/api/conversations',
        '/api/chat',
        '/api/products',
        '/api/promotions',
        '/api/faqs',
        '/api/menu',
      ]),
    );
    expect(document.paths['/api/chat']?.post).toEqual(
      expect.objectContaining({
        summary: 'Send an idempotent message to the web chatbot',
        requestBody: expect.any(Object) as object,
        responses: expect.objectContaining({
          '201': expect.any(Object) as object,
          '400': expect.any(Object) as object,
          '404': expect.any(Object) as object,
          '409': expect.any(Object) as object,
          '429': expect.any(Object) as object,
          '503': expect.any(Object) as object,
        }) as object,
      }),
    );
    expect(document.components?.schemas).toEqual(
      expect.objectContaining({
        WebChatMessageDto: expect.any(Object) as object,
        WebChatResponseDto: expect.any(Object) as object,
        ProductResponseDto: expect.any(Object) as object,
        ApiErrorResponseDto: expect.any(Object) as object,
      }),
    );
  });
});
