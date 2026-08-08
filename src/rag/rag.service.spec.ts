import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { DatabaseUnavailableException } from '../common/application-error';
import type { PrismaService } from '../database/prisma.service';
import { RagService } from './rag.service';
import { EMBEDDING_DIMENSIONS } from './rag.types';

describe('RagService', () => {
  const config = {
    get: jest.fn().mockReturnValue(0.5),
  } as unknown as ConfigService;

  it('embeds the query and returns the most relevant chunks', async () => {
    const embedding = Array<number>(EMBEDDING_DIMENSIONS).fill(0.01);
    const embed = jest.fn().mockResolvedValue(embedding);
    const queryRaw = jest.fn().mockResolvedValue([
      {
        sourceId: 'faq-hours',
        sourceKey: 'horario-atencion',
        sourceType: 'faq',
        content: 'Pregunta: ¿Cuál es el horario? Respuesta: Atendemos todos los días.',
        similarity: 0.91,
      },
    ]);
    const service = new RagService(
      { embed },
      { $queryRaw: queryRaw } as unknown as PrismaService,
      config,
    );

    const results = await service.search('¿A qué hora abren?', 3, { requestId: 'request-1' });

    expect(embed).toHaveBeenCalledWith('¿A qué hora abren?', { requestId: 'request-1' });
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      {
        sourceId: 'faq-hours',
        sourceKey: 'horario-atencion',
        sourceType: 'faq',
        content: 'Pregunta: ¿Cuál es el horario? Respuesta: Atendemos todos los días.',
        similarity: 0.91,
      },
    ]);
  });

  it('discards results below the configured similarity threshold', async () => {
    const embedding = Array<number>(EMBEDDING_DIMENSIONS).fill(0.01);
    const queryRaw = jest.fn().mockResolvedValue([
      {
        sourceId: 'faq-location',
        sourceKey: 'ubicacion',
        sourceType: 'faq',
        content: 'Dirección: Av. José Larco 880.',
        similarity: 0.84,
      },
      {
        sourceId: 'product-espresso',
        sourceKey: 'espresso-nube',
        sourceType: 'product',
        content: 'Producto: Espresso Nube.',
        similarity: 0.31,
      },
    ]);
    const service = new RagService(
      { embed: jest.fn().mockResolvedValue(embedding) },
      { $queryRaw: queryRaw } as unknown as PrismaService,
      config,
    );

    const results = await service.search('¿Dónde están ubicados?', 5);

    expect(results).toEqual([
      {
        sourceId: 'faq-location',
        sourceKey: 'ubicacion',
        sourceType: 'faq',
        content: 'Dirección: Av. José Larco 880.',
        similarity: 0.84,
      },
    ]);
  });

  it('logs a dedicated event when no result reaches the similarity threshold', async () => {
    const embedding = Array<number>(EMBEDDING_DIMENSIONS).fill(0.01);
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const service = new RagService(
      { embed: jest.fn().mockResolvedValue(embedding) },
      { $queryRaw: jest.fn().mockResolvedValue([]) } as unknown as PrismaService,
      config,
    );

    await expect(
      service.search('¿Tienen una sucursal en Cusco?', 5, { requestId: 'request-2' }),
    ).resolves.toEqual([]);
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'rag.search.no_results',
        requestId: 'request-2',
        topK: 5,
        minSimilarity: 0.5,
        resultCode: 'RAG_NO_RESULTS',
        results: 0,
        sources: [],
      }),
    );

    log.mockRestore();
  });

  it('distinguishes a PostgreSQL vector search failure from empty results', async () => {
    const embedding = Array<number>(EMBEDDING_DIMENSIONS).fill(0.01);
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const service = new RagService(
      { embed: jest.fn().mockResolvedValue(embedding) },
      {
        $queryRaw: jest.fn().mockRejectedValue(new Error('database unavailable')),
      } as unknown as PrismaService,
      config,
    );

    await expect(
      service.search('¿Cuál es el horario?', 5, { requestId: 'request-db' }),
    ).rejects.toEqual(new DatabaseUnavailableException());
    expect(error).toHaveBeenCalledWith({
      event: 'database.operation.failed',
      requestId: 'request-db',
      operation: 'rag.vector_search',
      failureCode: 'DATABASE_UNAVAILABLE',
      message: 'database unavailable',
    });
  });

  it('exposes only safe context fields to the generation model', async () => {
    const service = new RagService({ embed: jest.fn() }, {} as PrismaService, config);
    jest.spyOn(service, 'search').mockResolvedValue([
      {
        sourceId: 'product-espresso',
        sourceKey: 'espresso-nube',
        sourceType: 'product',
        content: 'Producto: Espresso Nube. Precio: PEN 8.00.',
        similarity: 0.94,
      },
      {
        sourceId: 'product-espresso',
        sourceKey: 'espresso-nube',
        sourceType: 'product',
        content: 'Contenido duplicado de menor relevancia.',
        similarity: 0.82,
      },
    ]);

    const context = await service.getContext('espresso', 5);

    expect(JSON.parse(context)).toEqual({
      retrievalStatus: 'results_found',
      knowledge: [
        {
          sourceId: 'product-espresso',
          sourceKey: 'espresso-nube',
          type: 'product',
          content: 'Producto: Espresso Nube. Precio: PEN 8.00.',
        },
      ],
    });
    expect(context).not.toContain('0.94');
    expect(context).not.toContain('Contenido duplicado');
  });

  it('identifies an empty retrieval context explicitly', async () => {
    const service = new RagService({ embed: jest.fn() }, {} as PrismaService, config);
    jest.spyOn(service, 'search').mockResolvedValue([]);

    const context = await service.getContext('información no disponible', 5);

    expect(JSON.parse(context)).toEqual({
      retrievalStatus: 'no_results',
      knowledge: [],
    });
  });
});
