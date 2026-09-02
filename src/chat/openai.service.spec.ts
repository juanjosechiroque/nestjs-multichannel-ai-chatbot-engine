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
import { routeToolChoice } from './chat-tool-router';
import { OpenAiService, type GenerateResponseInput } from './openai.service';
import { CatalogSearchTool } from './tools/catalog-search.tool';
import type { ChatTool } from './tools/chat-tool';
import { KnowledgeSearchTool } from './tools/knowledge-search.tool';
import { ManageOrderTool } from './tools/manage-order.tool';
import { MenuDocumentTool } from './tools/menu-document.tool';
import { PromotionSearchTool } from './tools/promotion-search.tool';
import { SetOrderCustomerTool } from './tools/set-order-customer.tool';

interface ResponsesClientStub {
  responses: {
    create: jest.Mock;
  };
}

function requestContext(requestId: string) {
  return { requestId, conversationId: 'conversation-1', channel: 'web' as const };
}

function generateInput(overrides: Partial<GenerateResponseInput> = {}): GenerateResponseInput {
  const message = overrides.message ?? 'Hola';
  const routing = routeToolChoice(message);

  return {
    context: requestContext('request-1'),
    message,
    instructions: 'Only answer questions about Café Nube.',
    history: [],
    orderContext: { activeOrder: null, confirmationReplayAvailable: false },
    conversationId: 'conversation-1',
    toolChoice: routing.toolChoice,
    ...(routing.knowledgeQueryOverride
      ? { knowledgeQueryOverride: routing.knowledgeQueryOverride }
      : {}),
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

interface ToolCollaborators {
  getContext: jest.Mock;
  searchProducts: jest.Mock;
  searchPromotions: jest.Mock;
  getDescriptor: jest.Mock;
  orderExecute: jest.Mock;
  setCustomerDetails: jest.Mock;
}

function createService(): {
  service: OpenAiService;
  create: jest.Mock;
  collaborators: ToolCollaborators;
} {
  const config = new ConfigService({
    OPENAI_API_KEY: 'test-api-key',
    OPENAI_MODEL: 'gpt-5.6-luna',
    OPENAI_TIMEOUT_MS: 20_000,
    OPENAI_MAX_RETRIES: 1,
    BUSINESS_TIME_ZONE: 'America/Lima',
  });
  const collaborators: ToolCollaborators = {
    getContext: jest.fn(),
    searchProducts: jest.fn(),
    searchPromotions: jest.fn(),
    getDescriptor: jest.fn(),
    orderExecute: jest.fn(),
    setCustomerDetails: jest.fn(),
  };
  const tools: ChatTool[] = [
    new KnowledgeSearchTool({ getContext: collaborators.getContext }),
    new CatalogSearchTool({ searchProducts: collaborators.searchProducts }),
    new PromotionSearchTool({ searchPromotions: collaborators.searchPromotions }, config),
    new MenuDocumentTool({ getDescriptor: collaborators.getDescriptor }),
    new ManageOrderTool({ execute: collaborators.orderExecute }),
    new SetOrderCustomerTool({ setCustomerDetails: collaborators.setCustomerDetails }),
  ];
  const service = new OpenAiService(config, tools);
  const client = service as unknown as { client: ResponsesClientStub };
  const create = jest.fn();
  client.client.responses.create = create;

  return { service, create, collaborators };
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
    const { service, create, collaborators } = createService();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
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
    expect(collaborators.getContext).not.toHaveBeenCalled();
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
    expect(
      (initialRequest?.tools ?? []).map((tool) => tool.type === 'function' && tool.name),
    ).toEqual([
      'search_knowledge',
      'search_catalog',
      'search_promotions',
      'get_menu_document',
      'manage_order',
    ]);
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
    const { service, create, collaborators } = createService();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const businessContext =
      '{"retrievalStatus":"results_found","knowledge":[{"sourceId":"faq-hours","sourceKey":"horario-atencion","type":"faq","content":"Atendemos todos los días."}]}';
    collaborators.getContext.mockResolvedValue(businessContext);
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

    expect(collaborators.getContext).toHaveBeenCalledTimes(1);
    expect(collaborators.getContext).toHaveBeenCalledWith(
      'horario de atención',
      5,
      requestContext('request-tool'),
    );
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

  it('forces knowledge search and rewrites the query for a location question', async () => {
    const { service, create, collaborators } = createService();
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
    collaborators.getContext.mockResolvedValue(businessContext);
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
      service.generate(generateInput({ message: '¿Dónde queda el local?' })),
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
    expect(collaborators.getContext).toHaveBeenCalledWith(
      'dirección exacta, ubicación, cómo llegar y enlace de mapa. Pregunta del cliente: ¿Dónde queda el local?',
      5,
      requestContext('request-1'),
    );
  });

  it('uses the original query for an explicit services question', async () => {
    const { service, create, collaborators } = createService();
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
    collaborators.getContext.mockResolvedValue(businessContext);
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

    await service.generate(generateInput({ message: '¿Qué servicios ofrecen?' }));

    expect(responseRequest(create, 0)?.tool_choice).toEqual({
      type: 'function',
      name: 'search_knowledge',
    });
    expect(collaborators.getContext).toHaveBeenCalledWith(
      '¿Qué servicios ofrecen?',
      5,
      requestContext('request-1'),
    );
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
    const { service, create, collaborators } = createService();
    collaborators.searchProducts.mockResolvedValue([
      {
        id: 'product-1',
        slug: 'cappuccino-nube',
        name: 'Cappuccino Nube',
        description: 'Espresso con leche vaporizada.',
        price: { toString: () => '13.00' },
        currency: 'PEN',
        category: 'HOT_DRINK',
        availableForOrdering: true,
        metadata: {},
      },
    ]);
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
      .mockResolvedValueOnce({ output: [functionCall], output_text: '', model: 'gpt-5.6-luna' })
      .mockResolvedValueOnce({
        output: [],
        output_text: structuredResponse('Cuesta S/ 13.00.', ['product-1']),
        model: 'gpt-5.6-luna',
      });

    await expect(
      service.generate(generateInput({ message: '¿Cuánto cuesta el cappuccino?' })),
    ).resolves.toEqual(
      expect.objectContaining({
        answer: 'Cuesta S/ 13.00.',
        usedSources: [
          { sourceId: 'product-1', sourceKey: 'cappuccino-nube', sourceType: 'product' },
        ],
        llmCalls: 2,
        usedTools: ['search_catalog'],
      }),
    );
    expect(collaborators.searchProducts).toHaveBeenCalledWith(
      {
        productName: 'cappuccino',
        category: ProductCategory.HOT_DRINK,
        maxPrice: 15,
        maxPriceExclusive: false,
        dietaryTags: ['VEGETARIAN'],
        excludedAllergens: ['TREE_NUTS'],
        containsCoffee: true,
        decaffeinated: false,
        caffeineFree: false,
        limit: 20,
      },
      requestContext('request-1'),
    );
    const finalInput = (responseRequest(create, 1)?.input ?? []) as unknown as Array<{
      type?: string;
      call_id?: string;
      output?: string;
    }>;
    const replayed = finalInput.find((item) => item.type === 'function_call_output');
    expect(replayed?.call_id).toBe('call-catalog');
    expect(JSON.parse(replayed?.output ?? '{}')).toEqual(
      expect.objectContaining({ catalogStatus: 'results_found' }),
    );
  });

  it('forces structured promotion search and attributes the current promotion', async () => {
    const { service, create, collaborators } = createService();
    collaborators.searchPromotions.mockResolvedValue([
      {
        id: 'promotion-1',
        slug: 'viernes-frio',
        name: 'Viernes frío',
        description: '15% de descuento todos los viernes.',
        startsAt: null,
        endsAt: null,
        metadata: { days: ['FRIDAY'] },
      },
    ]);
    const functionCall = {
      type: 'function_call',
      call_id: 'call-promotions',
      name: 'search_promotions',
      arguments: JSON.stringify({ scope: 'CURRENT', promotionName: null }),
    };
    create
      .mockResolvedValueOnce({ output: [functionCall], output_text: '', model: 'gpt-5.6-luna' })
      .mockResolvedValueOnce({
        output: [],
        output_text: structuredResponse('Ahora aplica Viernes frío.', ['promotion-1']),
        model: 'gpt-5.6-luna',
      });

    await expect(
      service.generate(generateInput({ message: '¿Qué promociones tienen en este momento?' })),
    ).resolves.toEqual(
      expect.objectContaining({
        answer: 'Ahora aplica Viernes frío.',
        usedTools: ['search_promotions'],
      }),
    );
    expect(collaborators.searchPromotions).toHaveBeenCalledWith(
      expect.objectContaining({ includeNotStarted: false }),
      requestContext('request-1'),
    );
    expect(responseRequest(create, 0)?.tool_choice).toEqual({
      type: 'function',
      name: 'search_promotions',
    });
  });

  it('returns the menu document descriptor without sending catalog products to the model', async () => {
    const { service, create, collaborators } = createService();
    collaborators.getDescriptor.mockReturnValue({
      type: 'document',
      title: 'Carta de Café Nube',
      url: '/api/menu',
      mimeType: 'application/pdf',
    });
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
      service.generate(generateInput({ message: 'Quiero ver la carta' })),
    ).resolves.toEqual(
      expect.objectContaining({
        answer: 'Aquí tienes nuestra carta.',
        usedTools: ['get_menu_document'],
        content: [
          {
            type: 'document',
            title: 'Carta de Café Nube',
            url: '/api/menu',
            mimeType: 'application/pdf',
          },
        ],
      }),
    );
    expect(collaborators.getDescriptor).toHaveBeenCalledTimes(1);
  });

  it('executes manage_order with only an action, product names, and quantities', async () => {
    const { service, create, collaborators } = createService();
    const orderOutput = JSON.stringify({
      orderOperationStatus: 'completed',
      action: 'ADD_ITEMS',
      order: { total: 35, currency: 'PEN', items: [] },
      issues: [],
    });
    collaborators.orderExecute.mockResolvedValue(orderOutput);
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
      service.generate(generateInput({ message: 'Agrega dos cappuccinos y un croissant.' })),
    ).resolves.toEqual(
      expect.objectContaining({
        answer: 'Agregué 2 cappuccinos y 1 croissant. Total: S/ 35.',
        usedTools: ['manage_order'],
      }),
    );
    expect(collaborators.orderExecute).toHaveBeenCalledWith({
      action: 'ADD_ITEMS',
      items: [
        { productName: 'Cappuccino Nube', quantity: 2 },
        { productName: 'Croissant de mantequilla', quantity: 1 },
      ],
      conversationId: 'conversation-1',
      context: requestContext('request-1'),
    });
  });

  it('stores explicit customer details through the dedicated order tool', async () => {
    const { service, create, collaborators } = createService();
    collaborators.setCustomerDetails.mockResolvedValue(
      JSON.stringify({
        orderOperationStatus: 'completed',
        action: OrderAction.SET_CUSTOMER_DETAILS,
        order: { total: 13, currency: 'PEN', items: [] },
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
        }),
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        answer: 'Gracias, Ana. Tu total es S/ 13. ¿Deseas confirmar el pedido?',
        usedTools: ['set_order_customer'],
      }),
    );
    expect(collaborators.setCustomerDetails).toHaveBeenCalledWith(
      { customerName: 'Ana Pérez', customerPhone: '+51 987 654 321' },
      'conversation-1',
      requestContext('request-1'),
    );
    expect(responseRequest(create, 0)?.tools).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'function', name: 'set_order_customer', strict: true }),
      ]),
    );
  });

  it('offers only the trusted workflow actions to the manage_order tool', async () => {
    const { service, create, collaborators } = createService();
    collaborators.orderExecute.mockResolvedValue(
      JSON.stringify({
        orderOperationStatus: 'completed',
        action: OrderAction.CONFIRM,
        order: { total: 54, currency: 'PEN', items: [] },
        workflow: { allowedActions: [], canConfirm: false, nextAction: null },
        issues: [],
      }),
    );
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

    await service.generate(
      generateInput({
        message: 'sí',
        orderContext: {
          activeOrder: {
            order: {
              orderNumber: null,
              total: 54,
              currency: 'PEN',
              customer: { name: 'Ana Pérez', maskedPhone: '*******789' },
              items: [{ productName: 'Latte', unitPrice: 13, quantity: 3, lineTotal: 39 }],
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
      }),
    );

    const orderTool = responseRequest(create, 0)?.tools?.find(
      (tool) => tool.type === 'function' && tool.name === 'manage_order',
    );
    const orderParameters = (orderTool?.type === 'function' ? orderTool.parameters : undefined) as
      { properties?: { action?: { enum?: string[] } } } | undefined;
    expect(orderParameters?.properties?.action?.enum).toEqual([
      OrderAction.ADD_ITEMS,
      OrderAction.REMOVE_ITEMS,
      OrderAction.CONFIRM,
      OrderAction.CANCEL,
    ]);
    expect(collaborators.orderExecute).toHaveBeenCalledWith(
      expect.objectContaining({ action: OrderAction.CONFIRM, items: [] }),
    );
  });

  it('maps a tool argument validation failure to a controlled request failure', async () => {
    const { service, create, collaborators } = createService();
    create.mockResolvedValue({
      output: [
        {
          type: 'function_call',
          call_id: 'call-invalid-order',
          name: 'manage_order',
          arguments: JSON.stringify({ action: 'CONFIRM', items: [], total: 1 }),
        },
      ],
      output_text: '',
      model: 'gpt-5.6-luna',
    });

    await expect(service.generate(generateInput())).rejects.toEqual(
      new OpenAiRequestFailedException(),
    );
    expect(collaborators.orderExecute).not.toHaveBeenCalled();
  });

  it('rejects invalid tool arguments without executing application code', async () => {
    const { service, create, collaborators } = createService();
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

    await expect(service.generate(generateInput())).rejects.toEqual(
      new OpenAiRequestFailedException(),
    );
    expect(collaborators.getContext).not.toHaveBeenCalled();
  });

  it('throws when OpenAI requests an unregistered tool', async () => {
    const { service, create } = createService();
    create.mockResolvedValue({
      output: [
        {
          type: 'function_call',
          call_id: 'call-unknown',
          name: 'search_reviews',
          arguments: '{}',
        },
      ],
      output_text: '',
      model: 'gpt-5.6-luna',
    });

    await expect(service.generate(generateInput())).rejects.toEqual(
      new OpenAiRequestFailedException(),
    );
  });

  it('rejects when OpenAI requests more than one tool', async () => {
    const { service, create } = createService();
    create.mockResolvedValue({
      output: [
        {
          type: 'function_call',
          call_id: 'a',
          name: 'search_knowledge',
          arguments: '{"query":"x"}',
        },
        { type: 'function_call', call_id: 'b', name: 'search_catalog', arguments: '{}' },
      ],
      output_text: '',
      model: 'gpt-5.6-luna',
    });

    await expect(service.generate(generateInput())).rejects.toEqual(
      new OpenAiRequestFailedException(),
    );
  });

  it('preserves a database failure raised by the knowledge tool', async () => {
    const { service, create, collaborators } = createService();
    collaborators.getContext.mockRejectedValue(new DatabaseUnavailableException());
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

    await expect(service.generate(generateInput())).rejects.toEqual(
      new DatabaseUnavailableException(),
    );
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
    const { service, create, collaborators } = createService();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    collaborators.getContext.mockResolvedValue('{"retrievalStatus":"no_results","knowledge":[]}');
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

    await expect(service.generate(generateInput({ message: '¿Qué venden?' }))).rejects.toEqual(
      new OpenAiIncompleteResponseException('max_output_tokens'),
    );
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
    { name: 'an empty structured answer', outputText: structuredResponse('   ') },
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
