import { ConfigService } from '@nestjs/config';
import type { ToolInvocationContext } from './chat-tool';
import { PromotionSearchTool } from './promotion-search.tool';

describe('PromotionSearchTool', () => {
  const context = {
    requestId: 'request-1',
    conversationId: 'conversation-1',
    channel: 'web' as const,
  };
  const invocation: ToolInvocationContext = {
    requestContext: context,
    conversationId: 'conversation-1',
    orderContext: { activeOrder: null, confirmationReplayAvailable: false },
    message: '¿Qué promociones hay?',
  };
  const fridayEvening = new Date('2026-08-15T00:30:00.000Z');
  const promotions = [
    {
      id: 'friday-id',
      slug: 'viernes-frio',
      name: 'Viernes frío',
      description: '15% de descuento todos los viernes.',
      startsAt: null,
      endsAt: null,
      metadata: { days: ['FRIDAY'], discountPercentage: 15 },
    },
    {
      id: 'breakfast-id',
      slug: 'desayuno-nube',
      name: 'Desayuno Nube',
      description: 'Precio especial de lunes a viernes de 7:00 a 10:00.',
      startsAt: new Date('2026-01-01T05:00:00.000Z'),
      endsAt: null,
      metadata: {
        days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY'],
        startTime: '07:00',
        endTime: '10:00',
      },
    },
  ];

  function createTool(searchPromotions = jest.fn().mockResolvedValue(promotions)) {
    return {
      searchPromotions,
      tool: new PromotionSearchTool(
        { searchPromotions },
        new ConfigService({ BUSINESS_TIME_ZONE: 'America/Lima' }),
      ),
    };
  }

  it('returns only promotions valid at the current business date and time', async () => {
    const { tool, searchPromotions } = createTool();

    const output = JSON.parse(
      await tool.execute({ scope: 'CURRENT', promotionName: null }, invocation, fridayEvening),
    ) as {
      promotionStatus: string;
      scope: string;
      evaluatedAt: string;
      timeZone: string;
      currentPromotions: Array<{
        sourceKey: string;
        currentlyValid: boolean;
        schedule: {
          days: string[];
          startTime: string | null;
          endTime: string | null;
          timeZone: string;
        };
        terms: Record<string, unknown>;
      }>;
      otherPromotions?: unknown[];
    };

    expect(searchPromotions).toHaveBeenCalledWith(
      { evaluatedAt: fridayEvening, includeNotStarted: false },
      context,
    );
    expect(output.promotionStatus).toBe('current_promotions_found');
    expect(output.scope).toBe('CURRENT');
    expect(output.evaluatedAt).toBe(fridayEvening.toISOString());
    expect(output.timeZone).toBe('America/Lima');
    expect(output.currentPromotions).toHaveLength(1);
    expect(output.currentPromotions[0]).toEqual({
      sourceKey: 'viernes-frio',
      currentlyValid: true,
      schedule: {
        days: ['FRIDAY'],
        startTime: null,
        endTime: null,
        timeZone: 'America/Lima',
      },
      terms: { discountPercentage: 15 },
      sourceId: 'friday-id',
      type: 'promotion',
      name: 'Viernes frío',
      description: '15% de descuento todos los viernes.',
      startsAt: null,
      endsAt: null,
    });
    expect(output.otherPromotions).toBeUndefined();
  });

  it('separates current and other published promotions in catalog scope', async () => {
    const futurePromotion = {
      ...promotions[0],
      id: 'future-id',
      slug: 'future-promotion',
      name: 'Promoción futura',
      startsAt: new Date('2026-09-01T05:00:00.000Z'),
    };
    const { tool, searchPromotions } = createTool(
      jest.fn().mockResolvedValue([...promotions, futurePromotion]),
    );

    const output = JSON.parse(
      await tool.execute({ scope: 'CATALOG', promotionName: null }, invocation, fridayEvening),
    ) as {
      currentPromotions: Array<{ sourceKey: string }>;
      otherPromotions: Array<{ sourceKey: string }>;
    };

    expect(searchPromotions).toHaveBeenCalledWith(
      { evaluatedAt: fridayEvening, includeNotStarted: true },
      context,
    );
    expect(output.currentPromotions.map((promotion) => promotion.sourceKey)).toEqual([
      'viernes-frio',
    ]);
    expect(output.otherPromotions.map((promotion) => promotion.sourceKey)).toEqual([
      'desayuno-nube',
      'future-promotion',
    ]);
  });

  it('reports explicitly when no promotion is currently valid', async () => {
    const { tool } = createTool(jest.fn().mockResolvedValue([promotions[1]]));

    await expect(
      tool.execute({ scope: 'CURRENT', promotionName: null }, invocation, fridayEvening),
    ).resolves.toContain('"promotionStatus":"no_current_promotions"');
  });

  it('passes a requested promotion name as a structured database filter', async () => {
    const { tool, searchPromotions } = createTool(jest.fn().mockResolvedValue([]));

    await tool.execute(
      { scope: 'CATALOG', promotionName: 'Desayuno Nube' },
      invocation,
      fridayEvening,
    );

    expect(searchPromotions).toHaveBeenCalledWith(
      {
        promotionName: 'Desayuno Nube',
        evaluatedAt: fridayEvening,
        includeNotStarted: true,
      },
      context,
    );
  });

  describe('buildDefinition', () => {
    it('describes a strict scope/promotionName function tool', () => {
      const { tool } = createTool();
      const definition = tool.buildDefinition();

      expect(definition).toEqual(
        expect.objectContaining({ type: 'function', name: 'search_promotions', strict: true }),
      );
      expect(definition.parameters).toEqual(
        expect.objectContaining({
          required: ['scope', 'promotionName'],
          additionalProperties: false,
        }),
      );
    });
  });

  describe('parseArguments', () => {
    it('normalizes a valid promotion filter', () => {
      const { tool } = createTool();

      expect(tool.parseArguments('{"scope":"CATALOG","promotionName":"  Viernes  "}')).toEqual({
        scope: 'CATALOG',
        promotionName: 'Viernes',
      });
      expect(tool.parseArguments('{"scope":"CURRENT","promotionName":null}')).toEqual({
        scope: 'CURRENT',
        promotionName: null,
      });
    });

    it.each([
      { name: 'an unknown scope', payload: '{"scope":"YESTERDAY","promotionName":null}' },
      { name: 'a blank promotion name', payload: '{"scope":"CURRENT","promotionName":"  "}' },
      { name: 'an extra property', payload: '{"scope":"CURRENT","promotionName":null,"x":1}' },
    ])('throws for $name', ({ payload }) => {
      const { tool } = createTool();

      expect(() => tool.parseArguments(payload)).toThrow(
        'OpenAI returned invalid search_promotions arguments',
      );
    });
  });
});
