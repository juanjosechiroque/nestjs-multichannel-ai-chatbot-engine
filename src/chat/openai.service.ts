import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PRODUCT_ALLERGENS, PRODUCT_DIETARY_TAGS } from '../catalog/catalog-preferences';
import {
  ApplicationServiceUnavailableException,
  OpenAiEmptyResponseException,
  OpenAiIncompleteResponseException,
  OpenAiRequestFailedException,
} from '../common/application-error';
import type { RequestContext } from '../common/request-context';
import { ProductCategory } from '../generated/prisma/enums';
import type { ChatHistoryMessage } from '../memory/memory.types';
import type { KnowledgeSourceType, RagSourceReference } from '../rag/rag.types';
import { OrderAction } from '../order/order.types';
import type { ChatContent, DocumentChatContent } from './chat.types';
import { addTokenUsage, type TokenUsage } from './token-usage';
import type { CatalogSearchArguments } from './tools/catalog-search.tool';
import {
  type CustomerOrderAction,
  type OrderConversationContext,
  type OrderCustomerDetailsArguments,
  type OrderToolArguments,
} from './tools/order.tool';

export interface GenerateResponseInput {
  context: RequestContext;
  message: string;
  instructions: string;
  history: ChatHistoryMessage[];
  orderContext: OrderConversationContext;
  manageOrder: (order: OrderToolArguments) => Promise<string>;
  setOrderCustomer: (details: OrderCustomerDetailsArguments) => Promise<string>;
  getMenuDocument: () => Promise<string>;
  searchCatalog: (filters: CatalogSearchArguments) => Promise<string>;
  searchKnowledge: (query: string) => Promise<string>;
}

export interface GenerateResponseResult {
  answer: string;
  usedSources: RagSourceReference[];
  llmCalls: number;
  usedTools: string[];
  tokenUsage?: TokenUsage;
  content?: ChatContent[];
}

interface StructuredChatResponse {
  answer: string;
  usedSourceIds: string[];
}

interface KnowledgeSearchArguments {
  query: string;
}

function isOrderToolItemArgument(value: unknown): value is OrderToolArguments['items'][number] {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const item = value as Record<string, unknown>;
  return (
    typeof item.productName === 'string' &&
    item.productName.trim().length > 0 &&
    item.productName.length <= 100 &&
    typeof item.quantity === 'number' &&
    Number.isInteger(item.quantity) &&
    item.quantity >= 1 &&
    item.quantity <= 99 &&
    Object.keys(item).every((key) => key === 'productName' || key === 'quantity')
  );
}

const KNOWLEDGE_SEARCH_TOOL_NAME = 'search_knowledge';
const CATALOG_SEARCH_TOOL_NAME = 'search_catalog';
const MENU_DOCUMENT_TOOL_NAME = 'get_menu_document';
const ORDER_TOOL_NAME = 'manage_order';
const ORDER_CUSTOMER_TOOL_NAME = 'set_order_customer';
const EMPTY_BUSINESS_CONTEXT = JSON.stringify({
  retrievalStatus: 'no_results',
  knowledge: [],
});

const KNOWLEDGE_SEARCH_TOOL: OpenAI.Responses.FunctionTool = {
  type: 'function',
  name: KNOWLEDGE_SEARCH_TOOL_NAME,
  description: [
    "Search the current business's confirmed knowledge base.",
    'Use it before answering factual questions about promotions, FAQs, location, hours, policies, or confirmed services.',
    'Use search_catalog instead for products, product descriptions, categories, exact prices, or product lists.',
    'Do not use it for greetings, thanks, brief social messages, or requests outside the business scope.',
    'Write a concise, self-contained search query that preserves the customer intent. If the customer question is already self-contained, pass it verbatim. Resolve true follow-up references from the conversation, but never include an unrelated previous topic.',
  ].join(' '),
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'A concise semantic query for the confirmed business information needed.',
        minLength: 1,
        maxLength: 500,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },
  strict: true,
};

const CATALOG_SEARCH_TOOL: OpenAI.Responses.FunctionTool = {
  type: 'function',
  name: CATALOG_SEARCH_TOOL_NAME,
  description: [
    "Search the current business's active product catalog in its database.",
    'Use it for product names, descriptions, categories, exact prices, complete product lists, price filters, declared allergens, dietary tags, and caffeine or coffee preferences.',
    'Do not use it for FAQs, policies, location, hours, services, or promotions.',
    'A catalog product being active does not confirm real-time stock availability.',
  ].join(' '),
  parameters: {
    type: 'object',
    properties: {
      productName: {
        type: ['string', 'null'],
        description: 'Full or partial product name, or null when no name filter is needed.',
        minLength: 1,
        maxLength: 100,
      },
      category: {
        type: ['string', 'null'],
        description: 'Product category filter, or null when all categories are acceptable.',
        enum: [...Object.values(ProductCategory), null],
      },
      maxPrice: {
        type: ['number', 'null'],
        description: 'Maximum price in the catalog currency, or null when there is no price limit.',
        minimum: 0,
        maximum: 10_000,
      },
      maxPriceExclusive: {
        type: 'boolean',
        description:
          'True when the customer says less than or below the maximum price; false for up to, at most, maximum, or when maxPrice is null.',
      },
      dietaryTags: {
        type: 'array',
        description:
          'Dietary tags every returned product must contain. Use an empty array when not requested.',
        items: { type: 'string', enum: [...PRODUCT_DIETARY_TAGS] },
        maxItems: PRODUCT_DIETARY_TAGS.length,
      },
      excludedAllergens: {
        type: 'array',
        description:
          'Declared allergens that returned products must not contain. Use an empty array when not requested. This does not guarantee absence of cross-contamination.',
        items: { type: 'string', enum: [...PRODUCT_ALLERGENS] },
        maxItems: PRODUCT_ALLERGENS.length,
      },
      containsCoffee: {
        type: ['boolean', 'null'],
        description:
          'True for products containing coffee, false for coffee-free products, or null when not requested.',
      },
      decaffeinated: {
        type: ['boolean', 'null'],
        description:
          'True for explicitly decaffeinated products, false when decaffeinated products must be excluded, or null when not requested.',
      },
      caffeineFree: {
        type: ['boolean', 'null'],
        description:
          'True for explicitly caffeine-free products, false for products not declared caffeine-free, or null when not requested.',
      },
    },
    required: [
      'productName',
      'category',
      'maxPrice',
      'maxPriceExclusive',
      'dietaryTags',
      'excludedAllergens',
      'containsCoffee',
      'decaffeinated',
      'caffeineFree',
    ],
    additionalProperties: false,
  },
  strict: true,
};

const MENU_DOCUMENT_TOOL: OpenAI.Responses.FunctionTool = {
  type: 'function',
  name: MENU_DOCUMENT_TOOL_NAME,
  description: [
    "Get the current business's customer-facing menu document.",
    'Use it when the customer explicitly asks to see, open, download, receive, or view the menu or full menu.',
    'Do not use it for broad discovery questions such as what the business sells, or for product category, price, preference, allergen, or order questions.',
    'The document is a presentation resource; use search_catalog for structured product facts and manage_order for order operations.',
  ].join(' '),
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  strict: true,
};

const NO_ACTIVE_ORDER_ACTIONS: CustomerOrderAction[] = [OrderAction.ADD_ITEMS];
const CONFIRMATION_REPLAY_ACTIONS: CustomerOrderAction[] = [
  OrderAction.ADD_ITEMS,
  OrderAction.CONFIRM,
];

function buildOrderTool(orderContext: OrderConversationContext): OpenAI.Responses.FunctionTool {
  const allowedActions =
    orderContext.activeOrder?.workflow.allowedActions ??
    (orderContext.confirmationReplayAvailable
      ? CONFIRMATION_REPLAY_ACTIONS
      : NO_ACTIVE_ORDER_ACTIONS);

  return {
    type: 'function',
    name: ORDER_TOOL_NAME,
    description: [
      "Modify or inspect the current conversation's order using application-controlled business rules.",
      `The actions currently allowed by the application are: ${allowedActions.join(', ')}. Never request another action.`,
      'Use ADD_ITEMS only when the customer explicitly asks to add or order products; do not use it when they are only browsing or asking what is available.',
      'Use REMOVE_ITEMS to remove quantities. Use REVIEW when the customer asks to see the current order or total, says the selected/current/listed items are the ones they want, or wants to proceed to confirmation.',
      'Use CONFIRM when the trusted current order context has canConfirm=true and the customer explicitly agrees to the preceding confirmation question.',
      'When confirmationReplayAvailable=true, CONFIRM is allowed only if the customer explicitly repeats the confirmation of the order that the assistant just confirmed. This is an idempotent replay, not a new order.',
      'Use CANCEL when explicitly requested.',
      'Provide product names and positive integer quantities exactly as expressed or identified in the conversation.',
      'The application resolves products, uses database prices, calculates totals, and validates every state transition.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: allowedActions,
          description: 'The single currently allowed order action requested by the customer.',
        },
        items: {
          type: 'array',
          description:
            'Products affected by ADD_ITEMS or REMOVE_ITEMS. Use an empty array for REVIEW, CONFIRM, and CANCEL.',
          items: {
            type: 'object',
            properties: {
              productName: {
                type: 'string',
                description: 'Product name or unambiguous product reference from the conversation.',
                minLength: 1,
                maxLength: 100,
              },
              quantity: {
                type: 'integer',
                description: 'Positive quantity to add or remove.',
                minimum: 1,
                maximum: 99,
              },
            },
            required: ['productName', 'quantity'],
            additionalProperties: false,
          },
          maxItems: 10,
        },
      },
      required: ['action', 'items'],
      additionalProperties: false,
    },
    strict: true,
  };
}

function buildOrderCustomerTool(
  orderContext: OrderConversationContext,
): OpenAI.Responses.FunctionTool | null {
  const activeOrder = orderContext.activeOrder;
  if (!activeOrder) return null;

  return {
    type: 'function',
    name: ORDER_CUSTOMER_TOOL_NAME,
    description: [
      "Save the current order's required customer name or phone number.",
      `The application still requires: ${activeOrder.workflow.missingCustomerFields.join(', ') || 'no fields'}.`,
      'Use only details explicitly provided by the customer or supplied as trusted channel identity.',
      'Use null for a field that the customer did not provide in the current message.',
      'Never invent, infer, or reuse a phone number from unrelated conversation content.',
    ].join(' '),
    parameters: {
      type: 'object',
      properties: {
        customerName: {
          type: ['string', 'null'],
          description: 'Customer name explicitly provided for the order, or null.',
          maxLength: 100,
        },
        customerPhone: {
          type: ['string', 'null'],
          description: 'Customer phone explicitly provided for the order, or null.',
          maxLength: 30,
        },
      },
      required: ['customerName', 'customerPhone'],
      additionalProperties: false,
    },
    strict: true,
  };
}

function buildChatTools(orderContext: OrderConversationContext): OpenAI.Responses.FunctionTool[] {
  const customerTool = buildOrderCustomerTool(orderContext);
  return [
    KNOWLEDGE_SEARCH_TOOL,
    CATALOG_SEARCH_TOOL,
    MENU_DOCUMENT_TOOL,
    buildOrderTool(orderContext),
    ...(customerTool ? [customerTool] : []),
  ];
}

const CHAT_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  name: 'chat_response',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      answer: {
        type: 'string',
        description: 'The customer-facing answer.',
      },
      usedSourceIds: {
        type: 'array',
        description: 'Identifiers of business-tool items that directly support the answer.',
        items: { type: 'string' },
      },
    },
    required: ['answer', 'usedSourceIds'],
    additionalProperties: false,
  },
};

function isLocationKnowledgeRequest(message: string): boolean {
  const normalizedMessage = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
  const hasExplicitLocationTerm =
    /\b(direccion|ubicacion|domicilio|sede|sedes|sucursal|sucursales)\b/.test(normalizedMessage);
  const asksWhere = /\b(donde|como llego|como llegar)\b/.test(normalizedMessage);
  const mentionsBusinessPlace = /\b(cafe|cafeteria|local|locales|queda|ubicad[oa]s?)\b/.test(
    normalizedMessage,
  );

  return hasExplicitLocationTerm || (asksWhere && mentionsBusinessPlace);
}

function isServicesKnowledgeRequest(message: string): boolean {
  const normalizedMessage = message
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  return /\b(servicio|servicios|facilidad|facilidades|comodidad|comodidades)\b/.test(
    normalizedMessage,
  );
}

function isKnowledgeSourceType(value: unknown): value is KnowledgeSourceType {
  return (
    value === 'product' || value === 'product_category' || value === 'promotion' || value === 'faq'
  );
}

@Injectable()
export class OpenAiService {
  private readonly client: OpenAI;
  private readonly logger = new Logger(OpenAiService.name);

  constructor(private readonly config: ConfigService) {
    this.client = new OpenAI({
      apiKey: this.config.getOrThrow<string>('OPENAI_API_KEY'),
      timeout: this.config.get<number>('OPENAI_GENERATION_TIMEOUT_MS', 20_000),
      maxRetries: this.config.get<number>('OPENAI_GENERATION_MAX_RETRIES', 1),
    });
  }

  async generate({
    context,
    message,
    instructions,
    history,
    orderContext,
    manageOrder,
    setOrderCustomer,
    getMenuDocument,
    searchCatalog,
    searchKnowledge,
  }: GenerateResponseInput): Promise<GenerateResponseResult> {
    const startedAt = Date.now();

    try {
      const initialInput = this.buildInput(message, history, orderContext);
      const tools = buildChatTools(orderContext);
      const locationKnowledgeRequest = isLocationKnowledgeRequest(message);
      const servicesKnowledgeRequest = isServicesKnowledgeRequest(message);
      const forceKnowledgeSearch = locationKnowledgeRequest || servicesKnowledgeRequest;
      const knowledgeQueryOverride = locationKnowledgeRequest
        ? `dirección exacta, ubicación, cómo llegar y enlace de mapa. Pregunta del cliente: ${message}`
        : servicesKnowledgeRequest
          ? message
          : undefined;
      const initialCallStartedAt = Date.now();
      const initialResponse = await this.createResponse({
        instructions,
        input: initialInput,
        tools,
        toolChoice: forceKnowledgeSearch
          ? { type: 'function', name: KNOWLEDGE_SEARCH_TOOL_NAME }
          : 'auto',
      });
      this.assertResponseCompleted(initialResponse);
      const toolCalls = initialResponse.output.filter(
        (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call',
      );

      if (toolCalls.length === 0) {
        return this.completeGeneration({
          response: initialResponse,
          responses: [initialResponse],
          businessContext: EMPTY_BUSINESS_CONTEXT,
          context,
          phase: 'initial',
          callStartedAt: initialCallStartedAt,
          totalStartedAt: startedAt,
          llmCalls: 1,
          usedTools: [],
        });
      }

      if (toolCalls.length !== 1) {
        throw new Error('OpenAI requested an unsupported number of tools');
      }

      const [toolCall] = toolCalls;
      if (!toolCall) {
        throw new Error('OpenAI did not provide the requested tool call');
      }
      this.logger.log({
        event: 'openai.tool.requested',
        ...context,
        model: initialResponse.model,
        phase: 'initial',
        tool: toolCall.name,
        durationMs: Date.now() - initialCallStartedAt,
        inputTokens: initialResponse.usage?.input_tokens,
        outputTokens: initialResponse.usage?.output_tokens,
        totalTokens: initialResponse.usage?.total_tokens,
      });

      const toolOutput = await this.executeToolCall({
        toolCall,
        manageOrder,
        setOrderCustomer,
        getMenuDocument,
        searchCatalog,
        searchKnowledge,
        knowledgeQueryOverride,
      });
      // The Responses API requires replaying every output item. The SDK models a few
      // output-only status variants more broadly than its input union, so bridge them via unknown.
      const continuationItems = initialResponse.output as unknown as OpenAI.Responses.ResponseInput;
      const continuationInput: OpenAI.Responses.ResponseInput = [
        ...initialInput,
        ...continuationItems,
        {
          type: 'function_call_output',
          call_id: toolCall.call_id,
          output: toolOutput,
        },
      ];
      const finalCallStartedAt = Date.now();
      const finalResponse = await this.createResponse({
        instructions,
        input: continuationInput,
        tools,
        toolChoice: 'none',
      });
      this.assertResponseCompleted(finalResponse);

      if (finalResponse.output.some((item) => item.type === 'function_call')) {
        throw new Error('OpenAI requested an additional tool after reaching the tool limit');
      }

      return this.completeGeneration({
        response: finalResponse,
        responses: [initialResponse, finalResponse],
        businessContext: toolOutput,
        context,
        phase: 'final',
        callStartedAt: finalCallStartedAt,
        totalStartedAt: startedAt,
        llmCalls: 2,
        usedTools: [toolCall.name],
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Unknown OpenAI error';
      const failure =
        error instanceof ApplicationServiceUnavailableException
          ? error
          : new OpenAiRequestFailedException();
      const event =
        failure.failureCode === 'OPENAI_EMPTY_RESPONSE'
          ? 'openai.response.empty'
          : failure.failureCode === 'OPENAI_INCOMPLETE_RESPONSE'
            ? 'openai.response.incomplete'
            : failure.failureCode === 'OPENAI_REQUEST_FAILED'
              ? 'openai.response.failed'
              : 'openai.tool.failed';
      this.logger.error({
        event,
        ...context,
        durationMs: Date.now() - startedAt,
        failureCode: failure.failureCode,
        message:
          error instanceof OpenAiIncompleteResponseException
            ? `OpenAI response incomplete: ${error.reason}`
            : message,
      });
      throw failure;
    }
  }

  private buildInput(
    message: string,
    history: ChatHistoryMessage[],
    orderContext: OrderConversationContext,
  ): OpenAI.Responses.ResponseInput {
    return [
      {
        role: 'developer',
        content: [
          {
            type: 'input_text',
            text: [
              'Trusted current order context from the application:',
              JSON.stringify(orderContext),
              'Use only the actions exposed by manage_order. If canConfirm=true and the customer explicitly agrees to the preceding confirmation question, call manage_order with CONFIRM. If confirmationReplayAvailable=true, repeat CONFIRM only for an explicit confirmation replay immediately following the successful confirmation.',
            ].join('\n'),
          },
        ],
      },
      ...history.map((historyMessage) => ({
        role: historyMessage.role,
        content: historyMessage.content,
      })),
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: `Customer message:\n${message}`,
          },
        ],
      },
    ];
  }

  private createResponse({
    instructions,
    input,
    tools,
    toolChoice,
  }: {
    instructions: string;
    input: OpenAI.Responses.ResponseInput;
    tools: OpenAI.Responses.FunctionTool[];
    toolChoice: OpenAI.Responses.ToolChoiceOptions | OpenAI.Responses.ToolChoiceFunction;
  }): Promise<OpenAI.Responses.Response> {
    return this.client.responses.create({
      model: this.config.get<string>('OPENAI_MODEL', 'gpt-5.6-luna'),
      instructions,
      input,
      tools,
      tool_choice: toolChoice,
      parallel_tool_calls: false,
      store: false,
      prompt_cache_options: { mode: 'explicit' },
      reasoning: { effort: 'low' },
      max_output_tokens: this.config.get<number>('OPENAI_MAX_OUTPUT_TOKENS', 2_000),
      text: { format: CHAT_RESPONSE_FORMAT },
    });
  }

  private assertResponseCompleted(response: OpenAI.Responses.Response): void {
    if (response.status !== 'incomplete') {
      return;
    }

    throw new OpenAiIncompleteResponseException(response.incomplete_details?.reason ?? 'unknown');
  }

  private completeGeneration({
    response,
    responses,
    businessContext,
    context,
    phase,
    callStartedAt,
    totalStartedAt,
    llmCalls,
    usedTools,
  }: {
    response: OpenAI.Responses.Response;
    responses: readonly OpenAI.Responses.Response[];
    businessContext: string;
    context: RequestContext;
    phase: 'initial' | 'final';
    callStartedAt: number;
    totalStartedAt: number;
    llmCalls: number;
    usedTools: string[];
  }): GenerateResponseResult {
    if (!response.output_text) {
      throw new OpenAiEmptyResponseException();
    }

    const generatedResponse = this.parseResponse(response.output_text);
    if (generatedResponse.answer.trim().length === 0) {
      throw new OpenAiEmptyResponseException();
    }
    const availableSources = this.getAvailableSources(businessContext);
    const invalidSourceIds = generatedResponse.usedSourceIds.filter(
      (sourceId) => !availableSources.has(sourceId),
    );
    const reportedSourceIds = [...new Set(generatedResponse.usedSourceIds)];
    const usedSources = reportedSourceIds.flatMap((sourceId) => {
      const source = availableSources.get(sourceId);
      return source ? [source] : [];
    });
    const tokenUsage = addTokenUsage(responses.map((item) => this.getTokenUsage(item)));

    if (invalidSourceIds.length > 0) {
      this.logger.warn({
        event: 'openai.response.invalid_source_ids',
        ...context,
        invalidSourceIds: [...new Set(invalidSourceIds)],
      });
    }

    this.logger.log({
      event: 'openai.response.completed',
      ...context,
      model: response.model,
      phase,
      durationMs: Date.now() - callStartedAt,
      totalDurationMs: Date.now() - totalStartedAt,
      llmCalls,
      ...tokenUsage,
      reportedSourceIds,
    });

    return {
      answer: generatedResponse.answer,
      usedSources,
      llmCalls,
      usedTools,
      tokenUsage,
      ...this.getContent(businessContext),
    };
  }

  private getTokenUsage(response: OpenAI.Responses.Response): TokenUsage {
    const usage = response.usage;
    const inputDetails = usage?.input_tokens_details as
      { cached_tokens?: number; cache_write_tokens?: number } | undefined;
    const outputDetails = usage?.output_tokens_details as { reasoning_tokens?: number } | undefined;

    return {
      inputTokens: usage?.input_tokens ?? 0,
      cachedInputTokens: inputDetails?.cached_tokens ?? 0,
      cacheWriteTokens: inputDetails?.cache_write_tokens ?? 0,
      outputTokens: usage?.output_tokens ?? 0,
      reasoningTokens: outputDetails?.reasoning_tokens ?? 0,
      totalTokens: usage?.total_tokens ?? 0,
    };
  }

  private executeToolCall({
    toolCall,
    manageOrder,
    setOrderCustomer,
    getMenuDocument,
    searchCatalog,
    searchKnowledge,
    knowledgeQueryOverride,
  }: {
    toolCall: OpenAI.Responses.ResponseFunctionToolCall;
    manageOrder: (order: OrderToolArguments) => Promise<string>;
    setOrderCustomer: (details: OrderCustomerDetailsArguments) => Promise<string>;
    getMenuDocument: () => Promise<string>;
    searchCatalog: (filters: CatalogSearchArguments) => Promise<string>;
    searchKnowledge: (query: string) => Promise<string>;
    knowledgeQueryOverride?: string;
  }): Promise<string> {
    switch (toolCall.name) {
      case KNOWLEDGE_SEARCH_TOOL_NAME: {
        const { query } = this.parseKnowledgeSearchArguments(toolCall.arguments);
        return searchKnowledge(knowledgeQueryOverride ?? query);
      }
      case CATALOG_SEARCH_TOOL_NAME:
        return searchCatalog(this.parseCatalogSearchArguments(toolCall.arguments));
      case MENU_DOCUMENT_TOOL_NAME:
        this.assertEmptyToolArguments(toolCall.arguments, MENU_DOCUMENT_TOOL_NAME);
        return getMenuDocument();
      case ORDER_TOOL_NAME:
        return manageOrder(this.parseOrderToolArguments(toolCall.arguments));
      case ORDER_CUSTOMER_TOOL_NAME:
        return setOrderCustomer(this.parseOrderCustomerArguments(toolCall.arguments));
      default:
        throw new Error(`OpenAI requested an unsupported tool: ${toolCall.name}`);
    }
  }

  private assertEmptyToolArguments(argumentsJson: string, toolName: string): void {
    const parsed: unknown = JSON.parse(argumentsJson);

    if (typeof parsed !== 'object' || parsed === null || Object.keys(parsed).length > 0) {
      throw new Error(`OpenAI returned invalid ${toolName} arguments`);
    }
  }

  private parseOrderToolArguments(argumentsJson: string): OrderToolArguments {
    const parsed: unknown = JSON.parse(argumentsJson);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('action' in parsed) ||
      !('items' in parsed) ||
      Object.keys(parsed).some((key) => key !== 'action' && key !== 'items') ||
      !Array.isArray(parsed.items) ||
      parsed.items.length > 10
    ) {
      throw new Error('OpenAI returned invalid manage_order arguments');
    }

    const actions = ['ADD_ITEMS', 'REMOVE_ITEMS', 'REVIEW', 'CONFIRM', 'CANCEL'] as const;
    const action = parsed.action;
    const rawItems: unknown[] = parsed.items;
    const validItems = rawItems.every(isOrderToolItemArgument);
    const itemAction = action === 'ADD_ITEMS' || action === 'REMOVE_ITEMS';

    if (
      typeof action !== 'string' ||
      !actions.some((allowedAction) => allowedAction === action) ||
      !validItems ||
      (itemAction ? rawItems.length === 0 : rawItems.length !== 0)
    ) {
      throw new Error('OpenAI returned invalid manage_order arguments');
    }

    return {
      action: action as OrderToolArguments['action'],
      items: rawItems.map((item) => ({
        productName: item.productName.trim(),
        quantity: item.quantity,
      })),
    };
  }

  private parseOrderCustomerArguments(argumentsJson: string): OrderCustomerDetailsArguments {
    const parsed: unknown = JSON.parse(argumentsJson);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('customerName' in parsed) ||
      !('customerPhone' in parsed) ||
      Object.keys(parsed).some((key) => key !== 'customerName' && key !== 'customerPhone')
    ) {
      throw new Error('OpenAI returned invalid set_order_customer arguments');
    }

    const customerName = parsed.customerName;
    const customerPhone = parsed.customerPhone;
    const validName =
      customerName === null ||
      (typeof customerName === 'string' &&
        customerName.trim().length >= 2 &&
        customerName.length <= 100);
    const validPhone =
      customerPhone === null ||
      (typeof customerPhone === 'string' &&
        customerPhone.trim().length > 0 &&
        customerPhone.length <= 30);

    if (!validName || !validPhone || (customerName === null && customerPhone === null)) {
      throw new Error('OpenAI returned invalid set_order_customer arguments');
    }

    return {
      customerName: customerName === null ? null : customerName.trim(),
      customerPhone: customerPhone === null ? null : customerPhone.trim(),
    };
  }

  private parseKnowledgeSearchArguments(argumentsJson: string): KnowledgeSearchArguments {
    const parsed: unknown = JSON.parse(argumentsJson);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('query' in parsed) ||
      typeof parsed.query !== 'string' ||
      parsed.query.trim().length === 0 ||
      parsed.query.length > 500 ||
      Object.keys(parsed).some((key) => key !== 'query')
    ) {
      throw new Error('OpenAI returned invalid search_knowledge arguments');
    }

    return { query: parsed.query.trim() };
  }

  private parseCatalogSearchArguments(argumentsJson: string): CatalogSearchArguments {
    const parsed: unknown = JSON.parse(argumentsJson);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('productName' in parsed) ||
      !('category' in parsed) ||
      !('maxPrice' in parsed) ||
      !('maxPriceExclusive' in parsed) ||
      !('dietaryTags' in parsed) ||
      !('excludedAllergens' in parsed) ||
      !('containsCoffee' in parsed) ||
      !('decaffeinated' in parsed) ||
      !('caffeineFree' in parsed) ||
      Object.keys(parsed).some(
        (key) =>
          key !== 'productName' &&
          key !== 'category' &&
          key !== 'maxPrice' &&
          key !== 'maxPriceExclusive' &&
          key !== 'dietaryTags' &&
          key !== 'excludedAllergens' &&
          key !== 'containsCoffee' &&
          key !== 'decaffeinated' &&
          key !== 'caffeineFree',
      )
    ) {
      throw new Error('OpenAI returned invalid search_catalog arguments');
    }

    const productName = parsed.productName;
    const category = parsed.category;
    const maxPrice = parsed.maxPrice;
    const maxPriceExclusive = parsed.maxPriceExclusive;
    const dietaryTags = parsed.dietaryTags;
    const excludedAllergens = parsed.excludedAllergens;
    const containsCoffee = parsed.containsCoffee;
    const decaffeinated = parsed.decaffeinated;
    const caffeineFree = parsed.caffeineFree;
    const validCategory =
      category === null || Object.values(ProductCategory).some((value) => value === category);
    const validDietaryTags =
      Array.isArray(dietaryTags) &&
      dietaryTags.length <= PRODUCT_DIETARY_TAGS.length &&
      dietaryTags.every(
        (value) =>
          typeof value === 'string' && PRODUCT_DIETARY_TAGS.some((allowed) => allowed === value),
      ) &&
      new Set(dietaryTags).size === dietaryTags.length;
    const validExcludedAllergens =
      Array.isArray(excludedAllergens) &&
      excludedAllergens.length <= PRODUCT_ALLERGENS.length &&
      excludedAllergens.every(
        (value) =>
          typeof value === 'string' && PRODUCT_ALLERGENS.some((allowed) => allowed === value),
      ) &&
      new Set(excludedAllergens).size === excludedAllergens.length;

    if (
      !(
        productName === null ||
        (typeof productName === 'string' &&
          productName.trim().length > 0 &&
          productName.length <= 100)
      ) ||
      typeof maxPriceExclusive !== 'boolean' ||
      !validCategory ||
      !(
        maxPrice === null ||
        (typeof maxPrice === 'number' &&
          Number.isFinite(maxPrice) &&
          maxPrice >= 0 &&
          maxPrice <= 10_000)
      ) ||
      !validDietaryTags ||
      !validExcludedAllergens ||
      !(containsCoffee === null || typeof containsCoffee === 'boolean') ||
      !(decaffeinated === null || typeof decaffeinated === 'boolean') ||
      !(caffeineFree === null || typeof caffeineFree === 'boolean')
    ) {
      throw new Error('OpenAI returned invalid search_catalog arguments');
    }

    return {
      productName: productName === null ? null : productName.trim(),
      category: category as ProductCategory | null,
      maxPrice,
      maxPriceExclusive,
      dietaryTags: dietaryTags as CatalogSearchArguments['dietaryTags'],
      excludedAllergens: excludedAllergens as CatalogSearchArguments['excludedAllergens'],
      containsCoffee,
      decaffeinated,
      caffeineFree,
    };
  }

  private parseResponse(outputText: string): StructuredChatResponse {
    const parsed: unknown = JSON.parse(outputText);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('answer' in parsed) ||
      typeof parsed.answer !== 'string' ||
      !('usedSourceIds' in parsed) ||
      !Array.isArray(parsed.usedSourceIds) ||
      !parsed.usedSourceIds.every((sourceId) => typeof sourceId === 'string')
    ) {
      throw new Error('OpenAI returned an invalid structured response');
    }

    return {
      answer: parsed.answer.replaceAll('\\n', '\n'),
      usedSourceIds: parsed.usedSourceIds,
    };
  }

  private getContent(businessContext: string): { content?: ChatContent[] } {
    const parsed: unknown = JSON.parse(businessContext);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('documentStatus' in parsed) ||
      parsed.documentStatus !== 'available' ||
      !('document' in parsed) ||
      !this.isDocumentContent(parsed.document)
    ) {
      return {};
    }

    return { content: [parsed.document] };
  }

  private isDocumentContent(value: unknown): value is DocumentChatContent {
    return (
      typeof value === 'object' &&
      value !== null &&
      'type' in value &&
      value.type === 'document' &&
      'title' in value &&
      typeof value.title === 'string' &&
      'url' in value &&
      typeof value.url === 'string' &&
      'mimeType' in value &&
      value.mimeType === 'application/pdf'
    );
  }

  private getAvailableSources(businessContext: string): Map<string, RagSourceReference> {
    const parsed: unknown = JSON.parse(businessContext);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (!('knowledge' in parsed) &&
        !('products' in parsed) &&
        !('orderOperationStatus' in parsed) &&
        !('documentStatus' in parsed)) ||
      ('knowledge' in parsed && !Array.isArray(parsed.knowledge)) ||
      ('products' in parsed && !Array.isArray(parsed.products))
    ) {
      throw new Error('Business context has an invalid structure');
    }

    const knowledge: unknown[] =
      'knowledge' in parsed && Array.isArray(parsed.knowledge) ? parsed.knowledge : [];
    const products: unknown[] =
      'products' in parsed && Array.isArray(parsed.products) ? parsed.products : [];

    return new Map<string, RagSourceReference>(
      [...knowledge, ...products].flatMap((item): Array<[string, RagSourceReference]> => {
        if (
          typeof item === 'object' &&
          item !== null &&
          'sourceId' in item &&
          typeof item.sourceId === 'string' &&
          'sourceKey' in item &&
          typeof item.sourceKey === 'string' &&
          'type' in item &&
          isKnowledgeSourceType(item.type)
        ) {
          return [
            [
              item.sourceId,
              {
                sourceId: item.sourceId,
                sourceKey: item.sourceKey,
                sourceType: item.type,
              },
            ],
          ];
        }

        return [];
      }),
    );
  }
}
