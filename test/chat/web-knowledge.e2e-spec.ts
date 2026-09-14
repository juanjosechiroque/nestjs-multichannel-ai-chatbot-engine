import { randomUUID } from 'node:crypto';
// Supertest uses a CommonJS `export =`, so an import assignment matches its runtime shape.
// eslint-disable-next-line @typescript-eslint/no-require-imports
import request = require('supertest');
import type { DocumentChatContent } from '../../src/chat/chat.types';
import { toVectorLiteral } from '../../src/rag/vector.util';
import { chatMessage, deterministicEmbedding, setupHttpE2E } from '../support/e2e-app';

interface ConversationResponse {
  sessionId: string;
}

describe('Web knowledge retrieval and menu HTTP', () => {
  const harness = setupHttpE2E();

  it('returns the menu as structured document content and serves its PDF', async () => {
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    harness.generate.mockImplementationOnce(async (input) => {
      const toolOutput: unknown = JSON.parse(await harness.toolBag(input).getMenuDocument());
      const document = (toolOutput as { document: DocumentChatContent }).document;

      return {
        answer: 'Aquí tienes nuestra carta.',
        usedSources: [],
        llmCalls: 2,
        usedTools: ['get_menu_document'],
        content: [document],
      };
    });

    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, 'Quiero ver la carta'))
      .expect(201, {
        reply: 'Aquí tienes nuestra carta.',
        content: [
          {
            type: 'document',
            title: 'Carta de Café Nube',
            url: '/api/menu',
            mimeType: 'application/pdf',
          },
        ],
      });

    const menuResponse = await request(harness.server).get('/api/menu').expect(200);
    expect(menuResponse.headers['content-type']).toContain('application/pdf');
    expect(menuResponse.headers['content-disposition']).toBe('inline; filename="menu.pdf"');
    expect(Buffer.isBuffer(menuResponse.body)).toBe(true);
    expect((menuResponse.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');
  });

  it('retrieves matching pgvector knowledge before generating and persisting a reply', async () => {
    const vectorLiteral = toVectorLiteral(deterministicEmbedding());
    const sourceId = 'faq-hours-e2e';
    const content =
      'Tipo: pregunta frecuente. Pregunta: ¿Cuál es el horario? Respuesta: Atendemos todos los días de 7:00 a. m. a 9:00 p. m.';
    await harness.prisma.$executeRaw`
      INSERT INTO "knowledge_chunks" (
        "id",
        "source_type",
        "source_id",
        "chunk_index",
        "content",
        "metadata",
        "embedding",
        "created_at",
        "updated_at"
      )
      VALUES (
        ${randomUUID()}::uuid,
        'faq',
        ${sourceId},
        0,
        ${content},
        '{"slug":"horario-atencion"}'::jsonb,
        ${vectorLiteral}::vector,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )
    `;
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    let toolOutput: string | undefined;
    harness.generate.mockImplementationOnce(async (input) => {
      toolOutput = await harness.toolBag(input).searchKnowledge('horario de atención');
      return {
        answer: 'Atendemos todos los días de 7:00 a. m. a 9:00 p. m.',
        usedSources: [
          {
            sourceId,
            sourceKey: 'horario-atencion',
            sourceType: 'faq',
          },
        ],
        llmCalls: 2,
        usedTools: ['search_knowledge'],
      };
    });

    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, '¿A qué hora atienden?'))
      .expect(201, { reply: 'Atendemos todos los días de 7:00 a. m. a 9:00 p. m.' });

    const generationInput = harness.generate.mock.calls[0]?.[0];
    expect(generationInput).toBeDefined();
    expect(JSON.parse(toolOutput ?? '')).toEqual({
      retrievalStatus: 'results_found',
      knowledge: [{ sourceId, sourceKey: 'horario-atencion', type: 'faq', content }],
    });
    expect(toolOutput).toContain(sourceId);
    expect(toolOutput).not.toContain('similarity');
    expect(harness.embed).toHaveBeenCalledWith('horario de atención', generationInput?.context);
    await expect(harness.prisma.conversationMessage.count()).resolves.toBe(2);
  });

  it('passes the persisted first exchange as history on the second message', async () => {
    const conversationResponse = await request(harness.server)
      .post('/api/conversations')
      .expect(201);
    const { sessionId } = conversationResponse.body as ConversationResponse;
    harness.generate
      .mockImplementationOnce(async (input) => {
        await harness.toolBag(input).searchKnowledge('bebidas calientes');
        return {
          answer: 'Tenemos bebidas calientes.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['search_knowledge'],
        };
      })
      .mockImplementationOnce(async (input) => {
        await harness.toolBag(input).searchKnowledge('la bebida caliente más barata');
        return {
          answer: 'El americano.',
          usedSources: [],
          llmCalls: 2,
          usedTools: ['search_knowledge'],
        };
      });

    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, '¿Qué bebidas calientes tienen?'))
      .expect(201);
    await request(harness.server)
      .post('/api/chat')
      .send(chatMessage(sessionId, '¿Y cuál es la más barata?'))
      .expect(201, { reply: 'El americano.' });

    const secondGenerationInput = harness.generate.mock.calls[1]?.[0];
    expect(harness.embed).toHaveBeenNthCalledWith(
      2,
      'la bebida caliente más barata',
      secondGenerationInput?.context,
    );
    expect(harness.generate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        message: '¿Y cuál es la más barata?',
        history: [
          { role: 'user', content: '¿Qué bebidas calientes tienen?' },
          { role: 'assistant', content: 'Tenemos bebidas calientes.' },
        ],
      }),
    );
  });
});
