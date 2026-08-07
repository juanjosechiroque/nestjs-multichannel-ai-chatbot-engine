import type { PrismaService } from '../database/prisma.service';
import type { ConfigService } from '@nestjs/config';
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

    const results = await service.search('¿A qué hora abren?', 3);

    expect(embed).toHaveBeenCalledWith('¿A qué hora abren?');
    expect(queryRaw).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      {
        sourceId: 'faq-hours',
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
        sourceType: 'faq',
        content: 'Dirección: Av. José Larco 880.',
        similarity: 0.84,
      },
      {
        sourceId: 'product-espresso',
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
        sourceType: 'faq',
        content: 'Dirección: Av. José Larco 880.',
        similarity: 0.84,
      },
    ]);
  });

  it('exposes only safe context fields to the generation model', async () => {
    const service = new RagService({ embed: jest.fn() }, {} as PrismaService, config);
    jest.spyOn(service, 'search').mockResolvedValue([
      {
        sourceId: 'product-espresso',
        sourceType: 'product',
        content: 'Producto: Espresso Nube. Precio: PEN 8.00.',
        similarity: 0.94,
      },
    ]);

    const context = await service.getContext('espresso', 5);

    expect(JSON.parse(context)).toEqual({
      knowledge: [
        {
          type: 'product',
          content: 'Producto: Espresso Nube. Precio: PEN 8.00.',
        },
      ],
    });
    expect(context).not.toContain('0.94');
  });
});
