import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';
import {
  DatabaseUnavailableException,
  OpenAiEmptyResponseException,
  OpenAiIncompleteResponseException,
  OpenAiRequestFailedException,
} from '../common/application-error';
import { ProductCategory } from '../generated/prisma/enums';
import { OrderAction } from '../order/order.types';
import { OpenAiService, type GenerateResponseInput } from './openai.service';

interface ResponsesClientStub {
  responses: {
    create: jest.Mock;
  };
}

function requestContext(requestId: string) {
  return { requestId, conversationId: 'conversation-1', channel: 'web' as const };
}

function generateInput(overrides: Partial<GenerateResponseInput> = {}): GenerateResponseInput {
  return {
    context: requestContext('request-1'),
    message: 'Hola',
    instructions: 'Only answer questions about Café Nube.',
    history: [],
    orderContext: { activeOrder: null, confirmationReplayAvailable: false },
    manageOrder: jest.fn(),
    setOrderCustomer: jest.fn(),
    getMenuDocument: jest.fn(),
    searchCatalog: jest.fn(),
    searchPromotions: jest.fn(),
    searchKnowledge: jest.fn(),
    ...overrides,
  };
}

function structuredResponse(answer: string, usedSourceIds: string[] = []) {
  return JSON.stringify({ answer, usedSourceIds });
}

const ZERO_TOKEN_USAGE = {
  inputTokens: 0,
  cachedInputTokens: 0,
  cacheWriteTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  totalTokens: 0,
};

function noOrderContextInput() {
  return {
    role: 'developer',
    content: [
      {
        type: 'input_text',
        text: [
          'Trusted current order context from the application:',
          '{"activeOrder":null,"confirmationReplayAvailable":false}',
          'Use only the actions exposed by manage_order. If canConfirm=true and the customer explicitly agrees to the preceding confirmation question, call manage_order with CONFIRM. If confirmationReplayAvailable=true, repeat CONFIRM only for an explicit confirmation replay immediately following the successful confirmation.',
        ].join('\n'),
      },
    ],
  };
}

function createService(): { service: OpenAiService; create: jest.Mock } {
  const service = new OpenAiService(
    new ConfigService({
      OPENAI_API_KEY: 'test-api-key',
      OPENAI_MODEL: 'gpt-5.6-luna',
      OPENAI_MAX_OUTPUT_TOKENS: 1_000,
      OPENAI_GENERATION_TIMEOUT_MS: 20_000,
      OPENAI_GENERATION_MAX_RETRIES: 1,
    }),
  );
  const client = service as unknown as { client: ResponsesClientStub };
  const create = jest.fn();
  client.client.responses.create = create;

  return { service, create };
}

function responseRequest(
  create: jest.Mock,
  index: number,
): OpenAI.Responses.ResponseCreateParamsNonStreaming | undefined {
  const calls = create.mock.calls as unknown[][];
  return calls[index]?.[0] as OpenAI.Responses.ResponseCreateParamsNonStreaming | undefined;
}

describe('OpenAiService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('lets the model answer a social message without running knowledge search', async () => {
    const { service, create } = createService();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const searchKnowledge = jest.fn();
    create.mockResolvedValue({
      output: [],
      output_text: structuredResponse('¡Hola! ¿En qué puedo ayudarte?'),
      model: 'gpt-5.6-luna',
      usage: {
        input_tokens: 20,
        input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
        output_tokens: 6,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 26,
      },
    });

    const result = await service.generate(
      generateInput({
        searchKnowledge,
        history: [
          { role: 'user', content: 'Buenos días' },
          { role: 'assistant', content: '¡Buenos días!' },
        ],
      }),
    );

    expect(result).toEqual({
      answer: '¡Hola! ¿En qué puedo ayudarte?',
      usedSources: [],
      llmCalls: 1,
      usedTools: [],
      tokenUsage: {
        inputTokens: 20,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 6,
        reasoningTokens: 0,
        totalTokens: 26,
      },
    });
    expect(searchKnowledge).not.toHaveBeenCalled();
    const configuredClient = service as unknown as {
      client: { timeout: number; maxRetries: number };
    };
    expect(configuredClient.client.timeout).toBe(20_000);
    expect(configuredClient.client.maxRetries).toBe(1);
    const initialRequest = responseRequest(create, 0);
    expect(initialRequest).toEqual(
      expect.objectContaining({
        model: 'gpt-5.6-luna',
        instructions: 'Only answer questions about Café Nube.',
        input: [
          noOrderContextInput(),
          { role: 'user', content: 'Buenos días' },
          { role: 'assistant', content: '¡Buenos días!' },
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Customer message:\nHola' }],
          },
        ],
        tool_choice: 'auto',
        parallel_tool_calls: false,
        store: false,
        prompt_cache_options: { mode: 'explicit' },
        reasoning: { effort: 'low' },
        max_output_tokens: 1_000,
      }),
    );
    expect(initialRequest?.tools).toHaveLength(5);
    expect(initialRequest?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function',
          name: 'search_catalog',
          strict: true,
        }),
      ]),
    );
    expect(initialRequest?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function',
          name: 'search_knowledge',
          strict: true,
        }),
      ]),
    );
    expect(initialRequest?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function',
          name: 'search_promotions',
          strict: true,
        }),
      ]),
    );
    expect(initialRequest?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: 'function',
          name: 'manage_order',
          strict: true,
        }),
      ]),
    );
    const tool = initialRequest?.tools?.[0];
    expect(tool?.type === 'function' ? tool.parameters : undefined).toEqual(
      expect.objectContaining({ additionalProperties: false }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'openai.response.completed',
        requestId: 'request-1',
        phase: 'initial',
        llmCalls: 1,
        reportedSourceIds: [],
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('Customer message');
  });

  it('executes search_knowledge once and sends its output back for the final answer', async () => {
    const { service, create } = createService();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const businessContext =
      '{"retrievalStatus":"results_found","knowledge":[{"sourceId":"faq-hours","sourceKey":"horario-atencion","type":"faq","content":"Atendemos todos los días."}]}';
    const searchKnowledge = jest.fn().mockResolvedValue(businessContext);
    const functionCall = {
      type: 'function_call',
      call_id: 'call-1',
      name: 'search_knowledge',
      arguments: '{"query":"horario de atención"}',
    };
    create
      .mockResolvedValueOnce({
        output: [{ type: 'reasoning', id: 'reasoning-1', summary: [] }, functionCall],
        output_text: '',
        model: 'gpt-5.6-luna',
        usage: { input_tokens: 20, output_tokens: 4, total_tokens: 24 },
      })
      .mockResolvedValueOnce({
        output: [],
        output_text: structuredResponse('Atendemos todos los días.', ['faq-hours']),
        model: 'gpt-5.6-luna',
        usage: {
          input_tokens: 30,
          input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
          output_tokens: 8,
          output_tokens_details: { reasoning_tokens: 0 },
          total_tokens: 38,
        },
      });

    await expect(
      service.generate(
        generateInput({
          context: requestContext('request-tool'),
          message: '¿Cuál es el horario?',
          searchKnowledge,
        }),
      ),
    ).resolves.toEqual({
      answer: 'Atendemos todos los días.',
      usedSources: [
        {
          sourceId: 'faq-hours',
          sourceKey: 'horario-atencion',
          sourceType: 'faq',
        },
      ],
      llmCalls: 2,
      usedTools: ['search_knowledge'],
      tokenUsage: {
        inputTokens: 50,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        outputTokens: 12,
        reasoningTokens: 0,
        totalTokens: 62,
      },
    });

    expect(searchKnowledge).toHaveBeenCalledTimes(1);
    expect(searchKnowledge).toHaveBeenCalledWith('horario de atención');
    expect(create).toHaveBeenCalledTimes(2);
    expect(responseRequest(create, 1)).toEqual(
      expect.objectContaining({
        tool_choice: 'none',
        parallel_tool_calls: false,
        input: [
          noOrderContextInput(),
          {
            role: 'user',
            content: [{ type: 'input_text', text: 'Customer message:\n¿Cuál es el horario?' }],
          },
          { type: 'reasoning', id: 'reasoning-1', summary: [] },
          functionCall,
          {
            type: 'function_call_output',
            call_id: 'call-1',
            output: businessContext,
          },
        ],
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'openai.tool.requested',
        requestId: 'request-tool',
        tool: 'search_knowledge',
      }),
    );
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'openai.response.completed',
        requestId: 'request-tool',
        phase: 'final',
        llmCalls: 2,
        reportedSourceIds: ['faq-hours'],
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('horario de atención');
  });

  it('forces knowledge search for a location question', async () => {
    const { service, create } = createService();
    const businessContext = JSON.stringify({
      retrievalStatus: 'results_found',
      knowledge: [
        {
          sourceId: 'faq-location',
          sourceKey: 'ubicacion',
          type: 'faq',
          content: 'Estamos en Av. José Larco 880, Miraflores, Lima.',
        },
      ],
    });
    const searchKnowledge = jest.fn().mockResolvedValue(businessContext);
    create
      .mockResolvedValueOnce({
        output: [
          {
            type: 'function_call',
            call_id: 'call-location',
            name: 'search_knowledge',
            arguments: '{"query":"local de Café Nube"}',
          },
        ],
        output_text: '',
        model: 'gpt-5.6-luna',
      })
      .mockResolvedValueOnce({
        output: [],
        output_text: structuredResponse('Estamos en Av. José Larco 880, Miraflores, Lima.', [
          'faq-location',
        ]),
        model: 'gpt-5.6-luna',
      });

    await expect(
      service.generate(
        generateInput({
          message: '¿Dónde queda el local?',
          searchKnowledge,
        }),
      ),
    ).resolves.toEqual({
      answer: 'Estamos en Av. José Larco 880, Miraflores, Lima.',
      usedSources: [
        {
          sourceId: 'faq-location',
          sourceKey: 'ubicacion',
          sourceType: 'faq',
        },
      ],
      llmCalls: 2,
      usedTools: ['search_knowledge'],
      tokenUsage: ZERO_TOKEN_USAGE,
    });
    expect(responseRequest(create, 0)?.tool_choice).toEqual({
      type: 'function',
      name: 'search_knowledge',
    });
    expect(searchKnowledge).toHaveBeenCalledWith(
      'dirección exacta, ubicación, cómo llegar y enlace de mapa. Pregunta del cliente: ¿Dónde queda el local?',
    );
  });

  it('uses the original query for an explicit services question', async () => {
    const { service, create } = createService();
    const businessContext = JSON.stringify({
      retrievalStatus: 'results_found',
      knowledge: [
        {
          sourceId: 'business-services-summary',
          sourceKey: 'servicios',
          type: 'faq',
          content: 'Servicios confirmados: delivery, recojo, wifi y espacio pet friendly.',
        },
      ],
    });
    const searchKnowledge = jest.fn().mockResolvedValue(businessContext);
    create
      .mockResolvedValueOnce({
        output: [
          {
            type: 'function_call',
            call_id: 'call-services',
            name: 'search_knowledge',
            arguments: '{"query":"información general del negocio"}',
          },
        ],
        output_text: '',
        model: 'gpt-5.6-luna',
      })
      .mockResolvedValueOnce({
        output: [],
        output_text: structuredResponse('Tenemos delivery, recojo, wifi y terraza pet friendly.', [
          'business-services-summary',
        ]),
        model: 'gpt-5.6-luna',
      });

    await service.generate(generateInput({ message: '¿Qué servicios ofrecen?', searchKnowledge }));

    expect(responseRequest(create, 0)?.tool_choice).toEqual({
      type: 'function',
      name: 'search_knowledge',
    });
    expect(searchKnowledge).toHaveBeenCalledWith('¿Qué servicios ofrecen?');
  });

  it('discards source identifiers that were not returned by the knowledge tool', async () => {
    const { service, create } = createService();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    create.mockResolvedValue({
      output: [],
      output_text: structuredResponse('Respuesta sin sustento.', [
        'invented-source',
        'invented-source',
      ]),
      model: 'gpt-5.6-luna',
    });

    await expect(service.generate(generateInput())).resolves.toEqual({
      answer: 'Respuesta sin sustento.',
      usedSources: [],
      llmCalls: 1,
      usedTools: [],
      tokenUsage: ZERO_TOKEN_USAGE,
    });
    expect(warn).toHaveBeenCalledWith({
      event: 'openai.response.invalid_source_ids',
      requestId: 'request-1',
      conversationId: 'conversation-1',
      channel: 'web',
      invalidSourceIds: ['invented-source'],
    });
  });

  it('executes search_catalog with validated filters and attributes returned products', async () => {
    const { service, create } = createService();
    const catalogOutput = JSON.stringify({
      catalogStatus: 'results_found',
      products: [
        {
          sourceId: 'product-1',
          sourceKey: 'cappuccino-nube',
          type: 'product',
          name: 'Cappuccino Nube',
          description: 'Espresso con leche vaporizada.',
          price: '13.00',
          currency: 'PEN',
          category: 'HOT_DRINK',
        },
      ],
    });
    const searchCatalog = jest.fn().mockResolvedValue(catalogOutput);
    const functionCall = {
      type: 'function_call',
      call_id: 'call-catalog',
      name: 'search_catalog',
      arguments: JSON.stringify({
        productName: 'cappuccino',
        category: 'HOT_DRINK',
        maxPrice: 15,
        maxPriceExclusive: false,
        dietaryTags: ['VEGETARIAN'],
        excludedAllergens: ['TREE_NUTS'],
        containsCoffee: true,
        decaffeinated: false,
        caffeineFree: false,
      }),
    };
    create
      .mockResolvedValueOnce({
        output: [functionCall],
        output_text: '',
        model: 'gpt-5.6-luna',
      })
      .mockResolvedValueOnce({
        output: [],
        output_text: structuredResponse('Cuesta S/ 13.00.', ['product-1']),
        model: 'gpt-5.6-luna',
      });

    await expect(
      service.generate(
        generateInput({
          message: '¿Cuánto cuesta el cappuccino?',
          searchCatalog,
        }),
      ),
    ).resolves.toEqual({
      answer: 'Cuesta S/ 13.00.',
      usedSources: [
        {
          sourceId: 'product-1',
          sourceKey: 'cappuccino-nube',
          sourceType: 'product',
        },
      ],
      llmCalls: 2,
      usedTools: ['search_catalog'],
      tokenUsage: ZERO_TOKEN_USAGE,
    });
    expect(searchCatalog).toHaveBeenCalledWith({
      productName: 'cappuccino',
      category: ProductCategory.HOT_DRINK,
      maxPrice: 15,
      maxPriceExclusive: false,
      dietaryTags: ['VEGETARIAN'],
      excludedAllergens: ['TREE_NUTS'],
      containsCoffee: true,
      decaffeinated: false,
      caffeineFree: false,
    });
    expect(responseRequest(create, 1)?.input).toEqual(
      expect.arrayContaining([
        {
          type: 'function_call_output',
          call_id: 'call-catalog',
          output: catalogOutput,
        },
      ]),
    );
  });

  it('forces structured promotion search and attributes the current promotion', async () => {
    const { service, create } = createService();
    const promotionOutput = JSON.stringify({
      promotionStatus: 'current_promotions_found',
      scope: 'CURRENT',
      evaluatedAt: '2026-08-15T00:30:00.000Z',
      timeZone: 'America/Lima',
      currentPromotions: [
        {
          sourceId: 'promotion-1',
          sourceKey: 'viernes-frio',
          type: 'promotion',
          name: 'Viernes frío',
          description: '15% de descuento todos los viernes.',
          currentlyValid: true,
        },
      ],
    });
    const searchPromotions = jest.fn().mockResolvedValue(promotionOutput);
    const functionCall = {
      type: 'function_call',
      call_id: 'call-promotions',
      name: 'search_promotions',
      arguments: JSON.stringify({ scope: 'CURRENT', promotionName: null }),
    };
    create
      .mockResolvedValueOnce({
        output: [functionCall],
        output_text: '',
        model: 'gpt-5.6-luna',
      })
      .mockResolvedValueOnce({
        output: [],
        output_text: structuredResponse('Ahora aplica Viernes frío.', ['promotion-1']),
        model: 'gpt-5.6-luna',
      });

    await expect(
      service.generate(
        generateInput({
          message: '¿Qué promociones tienen en este momento?',
          searchPromotions,
        }),
      ),
    ).resolves.toEqual({
      answer: 'Ahora aplica Viernes frío.',
      usedSources: [
        {
          sourceId: 'promotion-1',
          sourceKey: 'viernes-frio',
          sourceType: 'promotion',
        },
      ],
      llmCalls: 2,
      usedTools: ['search_promotions'],
      tokenUsage: ZERO_TOKEN_USAGE,
    });
    expect(searchPromotions).toHaveBeenCalledWith({
      scope: 'CURRENT',
      promotionName: null,
    });
    expect(responseRequest(create, 0)?.tool_choice).toEqual({
      type: 'function',
      name: 'search_promotions',
    });
    expect(responseRequest(create, 1)?.input).toEqual(
      expect.arrayContaining([
        {
          type: 'function_call_output',
          call_id: 'call-promotions',
          output: promotionOutput,
        },
      ]),
    );
  });

  it('returns the menu document descriptor without sending catalog products to the model', async () => {
    const { service, create } = createService();
    const menuOutput = JSON.stringify({
      documentStatus: 'available',
      document: {
        type: 'document',
        title: 'Carta de Café Nube',
        url: '/api/menu',
        mimeType: 'application/pdf',
      },
    });
    const getMenuDocument = jest.fn().mockResolvedValue(menuOutput);
    create
      .mockResolvedValueOnce({
        output: [
          {
            type: 'function_call',
            call_id: 'call-menu',
            name: 'get_menu_document',
            arguments: '{}',
          },
        ],
        output_text: '',
        model: 'gpt-5.6-luna',
      })
      .mockResolvedValueOnce({
        output: [],
        output_text: structuredResponse('Aquí tienes nuestra carta.', []),
        model: 'gpt-5.6-luna',
      });

    await expect(
      service.generate(
        generateInput({
          message: 'Quiero ver la carta',
          getMenuDocument,
        }),
      ),
    ).resolves.toEqual({
      answer: 'Aquí tienes nuestra carta.',
      usedSources: [],
      llmCalls: 2,
      usedTools: ['get_menu_document'],
      tokenUsage: ZERO_TOKEN_USAGE,
      content: [
        {
          type: 'document',
          title: 'Carta de Café Nube',
          url: '/api/menu',
          mimeType: 'application/pdf',
        },
      ],
    });
    expect(getMenuDocument).toHaveBeenCalledTimes(1);
    expect(responseRequest(create, 1)?.input).toEqual(
      expect.arrayContaining([
        {
          type: 'function_call_output',
          call_id: 'call-menu',
          output: menuOutput,
        },
      ]),
    );
    expect(menuOutput).not.toContain('products');
  });

  it('executes manage_order with only an action, product names, and quantities', async () => {
    const { service, create } = createService();
    const orderOutput = JSON.stringify({
      orderOperationStatus: 'completed',
      action: 'ADD_ITEMS',
      order: {
        id: 'order-1',
        status: 'SELECTING_PRODUCTS',
        total: 35,
        currency: 'PEN',
        items: [
          { productName: 'Cappuccino Nube', unitPrice: 13, quantity: 2, lineTotal: 26 },
          { productName: 'Croissant de mantequilla', unitPrice: 9, quantity: 1, lineTotal: 9 },
        ],
      },
      issues: [],
    });
    const manageOrder = jest.fn().mockResolvedValue(orderOutput);
    create
      .mockResolvedValueOnce({
        output: [
          {
            type: 'function_call',
            call_id: 'call-order',
            name: 'manage_order',
            arguments: JSON.stringify({
              action: 'ADD_ITEMS',
              items: [
                { productName: 'Cappuccino Nube', quantity: 2 },
                { productName: 'Croissant de mantequilla', quantity: 1 },
              ],
            }),
          },
        ],
        output_text: '',
        model: 'gpt-5.6-luna',
      })
      .mockResolvedValueOnce({
        output: [],
        output_text: structuredResponse('Agregué 2 cappuccinos y 1 croissant. Total: S/ 35.'),
        model: 'gpt-5.6-luna',
      });

    await expect(
      service.generate(
        generateInput({
          message: 'Agrega dos cappuccinos y un croissant.',
          manageOrder,
        }),
      ),
    ).resolves.toEqual({
      answer: 'Agregué 2 cappuccinos y 1 croissant. Total: S/ 35.',
      usedSources: [],
      llmCalls: 2,
      usedTools: ['manage_order'],
      tokenUsage: ZERO_TOKEN_USAGE,
    });
    expect(manageOrder).toHaveBeenCalledWith({
      action: 'ADD_ITEMS',
      items: [
        { productName: 'Cappuccino Nube', quantity: 2 },
        { productName: 'Croissant de mantequilla', quantity: 1 },
      ],
    });
    expect(responseRequest(create, 1)?.input).toEqual(
      expect.arrayContaining([
        {
          type: 'function_call_output',
          call_id: 'call-order',
          output: orderOutput,
        },
      ]),
    );
  });

  it('stores explicit customer details through the dedicated order tool', async () => {
    const { service, create } = createService();
    const setOrderCustomer = jest.fn().mockResolvedValue(
      JSON.stringify({
        orderOperationStatus: 'completed',
        action: OrderAction.SET_CUSTOMER_DETAILS,
        order: {
          orderNumber: null,
          total: 13,
          currency: 'PEN',
          customer: { name: 'Ana Pérez', maskedPhone: '*********321' },
          items: [{ productName: 'Latte', unitPrice: 13, quantity: 1, lineTotal: 13 }],
        },
        workflow: {
          allowedActions: [OrderAction.CONFIRM],
          canConfirm: true,
          nextAction: OrderAction.CONFIRM,
          missingCustomerFields: [],
        },
        issues: [],
      }),
    );
    create
      .mockResolvedValueOnce({
        output: [
          {
            type: 'function_call',
            call_id: 'call-customer-details',
            name: 'set_order_customer',
            arguments: JSON.stringify({
              customerName: 'Ana Pérez',
              customerPhone: '+51 987 654 321',
            }),
          },
        ],
        output_text: '',
        model: 'gpt-5.6-luna',
      })
      .mockResolvedValueOnce({
        output: [],
        output_text: structuredResponse(
          'Gracias, Ana. Tu total es S/ 13. ¿Deseas confirmar el pedido?',
        ),
        model: 'gpt-5.6-luna',
      });

    const activeOrder: GenerateResponseInput['orderContext'] = {
      activeOrder: {
        order: {
          orderNumber: null,
          total: 13,
          currency: 'PEN',
          customer: { name: null, maskedPhone: null },
          items: [{ productName: 'Latte', unitPrice: 13, quantity: 1, lineTotal: 13 }],
        },
        workflow: {
          allowedActions: [OrderAction.ADD_ITEMS, OrderAction.REMOVE_ITEMS, OrderAction.CANCEL],
          canConfirm: false,
          nextAction: null,
          missingCustomerFields: ['customerName', 'customerPhone'],
        },
      },
      confirmationReplayAvailable: false,
    };

    await expect(
      service.generate(
        generateInput({
          message: 'Soy Ana Pérez y mi celular es +51 987 654 321.',
          orderContext: activeOrder,
          setOrderCustomer,
        }),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        answer: 'Gracias, Ana. Tu total es S/ 13. ¿Deseas confirmar el pedido?',
        usedTools: ['set_order_customer'],
      }),
    );
    expect(setOrderCustomer).toHaveBeenCalledWith({
      customerName: 'Ana Pérez',
      customerPhone: '+51 987 654 321',
    });
    expect(responseRequest(create, 0)?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'function', name: 'set_order_customer', strict: true }),
      ]),
    );
  });

  it('limits order actions to the trusted workflow and confirms an explicit approval', async () => {
    const { service, create } = createService();
    const orderOutput = JSON.stringify({
      orderOperationStatus: 'completed',
      action: OrderAction.CONFIRM,
      order: {
        total: 54,
        currency: 'PEN',
        items: [
          { productName: 'Latte', unitPrice: 13, quantity: 3, lineTotal: 39 },
          { productName: 'Carrot cake', unitPrice: 15, quantity: 1, lineTotal: 15 },
        ],
      },
      workflow: { allowedActions: [], canConfirm: false, nextAction: null },
      issues: [],
    });
    const manageOrder = jest.fn().mockResolvedValue(orderOutput);
    create
      .mockResolvedValueOnce({
        output: [
          {
            type: 'function_call',
            call_id: 'call-confirm-order',
            name: 'manage_order',
            arguments: JSON.stringify({ action: OrderAction.CONFIRM, items: [] }),
          },
        ],
        output_text: '',
        model: 'gpt-5.6-luna',
      })
      .mockResolvedValueOnce({
        output: [],
        output_text: structuredResponse('Tu pedido fue confirmado. Total: S/ 54.'),
        model: 'gpt-5.6-luna',
      });

    await expect(
      service.generate(
        generateInput({
          message: 'sí',
          history: [
            {
              role: 'assistant',
              content: 'Total: S/ 54. ¿Deseas confirmar el pedido?',
            },
          ],
          orderContext: {
            activeOrder: {
              order: {
                orderNumber: null,
                total: 54,
                currency: 'PEN',
                customer: { name: 'Ana Pérez', maskedPhone: '*******789' },
                items: [
                  { productName: 'Latte', unitPrice: 13, quantity: 3, lineTotal: 39 },
                  { productName: 'Carrot cake', unitPrice: 15, quantity: 1, lineTotal: 15 },
                ],
              },
              workflow: {
                allowedActions: [
                  OrderAction.ADD_ITEMS,
                  OrderAction.REMOVE_ITEMS,
                  OrderAction.CONFIRM,
                  OrderAction.CANCEL,
                ],
                canConfirm: true,
                nextAction: OrderAction.CONFIRM,
                missingCustomerFields: [],
              },
            },
            confirmationReplayAvailable: false,
          },
          manageOrder,
        }),
      ),
    ).resolves.toEqual({
      answer: 'Tu pedido fue confirmado. Total: S/ 54.',
      usedSources: [],
      llmCalls: 2,
      usedTools: ['manage_order'],
      tokenUsage: ZERO_TOKEN_USAGE,
    });

    const orderTool = responseRequest(create, 0)?.tools?.find(
      (tool) => tool.type === 'function' && tool.name === 'manage_order',
    );
    const orderParameters = (orderTool?.type === 'function'
      ? orderTool.parameters
      : undefined) as unknown as { properties?: { action?: { enum?: string[] } } };
    expect(orderParameters.properties?.action?.enum).toEqual([
      OrderAction.ADD_ITEMS,
      OrderAction.REMOVE_ITEMS,
      OrderAction.CONFIRM,
      OrderAction.CANCEL,
    ]);
    expect(manageOrder).toHaveBeenCalledWith({ action: OrderAction.CONFIRM, items: [] });
  });

  it('allows an explicit confirmation replay without exposing other terminal actions', async () => {
    const { service, create } = createService();
    const confirmedOrder = {
      total: 13,
      currency: 'PEN',
      items: [{ productName: 'Latte', unitPrice: 13, quantity: 1, lineTotal: 13 }],
    };
    const manageOrder = jest.fn().mockResolvedValue(
      JSON.stringify({
        orderOperationStatus: 'completed',
        action: OrderAction.CONFIRM,
        idempotentReplay: true,
        order: confirmedOrder,
        workflow: { allowedActions: [], canConfirm: false, nextAction: null },
        issues: [],
      }),
    );
    create
      .mockResolvedValueOnce({
        output: [
          {
            type: 'function_call',
            call_id: 'call-replay-confirmation',
            name: 'manage_order',
            arguments: JSON.stringify({ action: OrderAction.CONFIRM, items: [] }),
          },
        ],
        output_text: '',
        model: 'gpt-5.6-luna',
      })
      .mockResolvedValueOnce({
        output: [],
        output_text: structuredResponse('Ese pedido ya estaba confirmado; no se duplicó.'),
        model: 'gpt-5.6-luna',
      });

    await service.generate(
      generateInput({
        message: 'Sí, confirma de nuevo.',
        history: [{ role: 'assistant', content: 'Tu pedido fue confirmado. Total: S/ 13.' }],
        orderContext: { activeOrder: null, confirmationReplayAvailable: true },
        manageOrder,
      }),
    );

    const orderTool = responseRequest(create, 0)?.tools?.find(
      (tool) => tool.type === 'function' && tool.name === 'manage_order',
    );
    const orderParameters = (orderTool?.type === 'function'
      ? orderTool.parameters
      : undefined) as unknown as { properties?: { action?: { enum?: string[] } } };
    expect(orderParameters.properties?.action?.enum).toEqual([
      OrderAction.ADD_ITEMS,
      OrderAction.CONFIRM,
    ]);
    expect(manageOrder).toHaveBeenCalledWith({ action: OrderAction.CONFIRM, items: [] });
  });

  it('rejects order arguments that try to supply application-controlled totals', async () => {
    const { service, create } = createService();
    const manageOrder = jest.fn();
    create.mockResolvedValue({
      output: [
        {
          type: 'function_call',
          call_id: 'call-invalid-order',
          name: 'manage_order',
          arguments: JSON.stringify({
            action: 'CONFIRM',
            items: [],
            total: 1,
          }),
        },
      ],
      output_text: '',
      model: 'gpt-5.6-luna',
    });

    await expect(service.generate(generateInput({ manageOrder }))).rejects.toEqual(
      new OpenAiRequestFailedException(),
    );
    expect(manageOrder).not.toHaveBeenCalled();
  });

  it('rejects invalid tool arguments without executing application code', async () => {
    const { service, create } = createService();
    const searchKnowledge = jest.fn();
    create.mockResolvedValue({
      output: [
        {
          type: 'function_call',
          call_id: 'call-invalid',
          name: 'search_knowledge',
          arguments: '{"query":"   "}',
        },
      ],
      output_text: '',
      model: 'gpt-5.6-luna',
    });

    await expect(service.generate(generateInput({ searchKnowledge }))).rejects.toEqual(
      new OpenAiRequestFailedException(),
    );
    expect(searchKnowledge).not.toHaveBeenCalled();
  });

  it('rejects invalid catalog filters without querying PostgreSQL', async () => {
    const { service, create } = createService();
    const searchCatalog = jest.fn();
    create.mockResolvedValue({
      output: [
        {
          type: 'function_call',
          call_id: 'call-invalid-catalog',
          name: 'search_catalog',
          arguments: JSON.stringify({
            productName: null,
            category: 'UNKNOWN_CATEGORY',
            maxPrice: -1,
            maxPriceExclusive: false,
            dietaryTags: [],
            excludedAllergens: [],
            containsCoffee: null,
            decaffeinated: null,
            caffeineFree: null,
          }),
        },
      ],
      output_text: '',
      model: 'gpt-5.6-luna',
    });

    await expect(service.generate(generateInput({ searchCatalog }))).rejects.toEqual(
      new OpenAiRequestFailedException(),
    );
    expect(searchCatalog).not.toHaveBeenCalled();
  });

  it('rejects invalid promotion scope without querying PostgreSQL', async () => {
    const { service, create } = createService();
    const searchPromotions = jest.fn();
    create.mockResolvedValue({
      output: [
        {
          type: 'function_call',
          call_id: 'call-invalid-promotion',
          name: 'search_promotions',
          arguments: JSON.stringify({ scope: 'YESTERDAY', promotionName: null }),
        },
      ],
      output_text: '',
      model: 'gpt-5.6-luna',
    });

    await expect(
      service.generate(generateInput({ message: '¿Qué promociones hubo ayer?', searchPromotions })),
    ).rejects.toEqual(new OpenAiRequestFailedException());
    expect(searchPromotions).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'an unknown dietary tag', override: { dietaryTags: ['KETO'] } },
    { name: 'a duplicated allergen', override: { excludedAllergens: ['MILK', 'MILK'] } },
    { name: 'a non-boolean coffee preference', override: { containsCoffee: 'false' } },
  ])('rejects $name without querying PostgreSQL', async ({ override }) => {
    const { service, create } = createService();
    const searchCatalog = jest.fn();
    create.mockResolvedValue({
      output: [
        {
          type: 'function_call',
          call_id: 'call-invalid-preference',
          name: 'search_catalog',
          arguments: JSON.stringify({
            productName: null,
            category: null,
            maxPrice: null,
            maxPriceExclusive: false,
            dietaryTags: [],
            excludedAllergens: [],
            containsCoffee: null,
            decaffeinated: null,
            caffeineFree: null,
            ...override,
          }),
        },
      ],
      output_text: '',
      model: 'gpt-5.6-luna',
    });

    await expect(service.generate(generateInput({ searchCatalog }))).rejects.toEqual(
      new OpenAiRequestFailedException(),
    );
    expect(searchCatalog).not.toHaveBeenCalled();
  });

  it('preserves a database failure raised by the knowledge tool', async () => {
    const { service, create } = createService();
    create.mockResolvedValue({
      output: [
        {
          type: 'function_call',
          call_id: 'call-database',
          name: 'search_knowledge',
          arguments: '{"query":"ubicación"}',
        },
      ],
      output_text: '',
      model: 'gpt-5.6-luna',
    });

    await expect(
      service.generate(
        generateInput({
          searchKnowledge: jest.fn().mockRejectedValue(new DatabaseUnavailableException()),
        }),
      ),
    ).rejects.toEqual(new DatabaseUnavailableException());
  });

  it.each([
    {
      name: 'OpenAI rejects the request',
      configure: (create: jest.Mock) => create.mockRejectedValue(new Error('network failure')),
    },
    {
      name: 'OpenAI returns an invalid structured response',
      configure: (create: jest.Mock) =>
        create.mockResolvedValue({
          output: [],
          output_text: JSON.stringify({ answer: 'Hola' }),
          model: 'gpt-5.6-luna',
        }),
    },
  ])('returns a controlled error when $name', async ({ configure }) => {
    const { service, create } = createService();
    configure(create);

    await expect(service.generate(generateInput())).rejects.toEqual(
      new OpenAiRequestFailedException(),
    );
  });

  it('classifies a truncated final response before attempting to parse its JSON', async () => {
    const { service, create } = createService();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const searchKnowledge = jest
      .fn()
      .mockResolvedValue('{"retrievalStatus":"no_results","knowledge":[]}');
    create
      .mockResolvedValueOnce({
        status: 'completed',
        incomplete_details: null,
        output: [
          {
            type: 'function_call',
            call_id: 'call-truncated',
            name: 'search_knowledge',
            arguments: '{"query":"productos disponibles"}',
          },
        ],
        output_text: '',
        model: 'gpt-5.6-luna',
      })
      .mockResolvedValueOnce({
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [],
        output_text: '{"answer":"respuesta truncada',
        model: 'gpt-5.6-luna',
      });

    await expect(
      service.generate(generateInput({ message: '¿Qué venden?', searchKnowledge })),
    ).rejects.toEqual(new OpenAiIncompleteResponseException('max_output_tokens'));
    expect(create).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'openai.response.incomplete',
        failureCode: 'OPENAI_INCOMPLETE_RESPONSE',
        message: 'OpenAI response incomplete: max_output_tokens',
      }),
    );
  });

  it.each([
    { name: 'an empty API output', outputText: '' },
    {
      name: 'an empty structured answer',
      outputText: structuredResponse('   '),
    },
  ])('classifies $name separately from an OpenAI request failure', async ({ outputText }) => {
    const { service, create } = createService();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    create.mockResolvedValue({ output: [], output_text: outputText, model: 'gpt-5.6-luna' });

    await expect(service.generate(generateInput())).rejects.toEqual(
      new OpenAiEmptyResponseException(),
    );
    expect(error).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'openai.response.empty',
        requestId: 'request-1',
        failureCode: 'OPENAI_EMPTY_RESPONSE',
      }),
    );
  });

  it('normalizes literal newline escapes in the customer-facing answer', async () => {
    const { service, create } = createService();
    create.mockResolvedValue({
      output: [],
      output_text: structuredResponse('Pedido confirmado.\\nTotal: S/ 30.'),
      model: 'gpt-5.6-luna',
    });

    await expect(service.generate(generateInput())).resolves.toEqual(
      expect.objectContaining({ answer: 'Pedido confirmado.\nTotal: S/ 30.' }),
    );
  });
});
