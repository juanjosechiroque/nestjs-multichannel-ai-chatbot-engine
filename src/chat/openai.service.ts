import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import { PRODUCT_ALLERGENS, PRODUCT_DIETARY_TAGS } from '../catalog/catalog-preferences';
import {
  ApplicationServiceUnavailableException,
  OpenAiEmptyResponseException,
  OpenAiRequestFailedException,
} from '../common/application-error';
import type { RequestContext } from '../common/request-context';
import { ProductCategory } from '../generated/prisma/enums';
import type { ChatHistoryMessage } from '../memory/memory.types';
import type { KnowledgeSourceType, RagSourceReference } from '../rag/rag.types';
import type { CatalogSearchArguments } from './tools/catalog-search.tool';

export interface GenerateResponseInput {
  context: RequestContext;
  message: string;
  instructions: string;
  history: ChatHistoryMessage[];
  searchCatalog: (filters: CatalogSearchArguments) => Promise<string>;
  searchKnowledge: (query: string) => Promise<string>;
}

export interface GenerateResponseResult {
  answer: string;
  usedSources: RagSourceReference[];
  llmCalls: number;
  usedTools: string[];
}

interface StructuredChatResponse {
  answer: string;
  usedSourceIds: string[];
}

interface KnowledgeSearchArguments {
  query: string;
}

const KNOWLEDGE_SEARCH_TOOL_NAME = 'search_knowledge';
const CATALOG_SEARCH_TOOL_NAME = 'search_catalog';
const EMPTY_BUSINESS_CONTEXT = JSON.stringify({
  retrievalStatus: 'no_results',
  knowledge: [],
});

const KNOWLEDGE_SEARCH_TOOL: OpenAI.Responses.FunctionTool = {
  type: 'function',
  name: KNOWLEDGE_SEARCH_TOOL_NAME,
  description: [
    "Search the current business's confirmed knowledge base.",
    'Use it before answering factual questions about promotions, FAQs, location, hours, policies, or published services.',
    'Use search_catalog instead for products, product descriptions, categories, exact prices, or product lists.',
    'Do not use it for greetings, thanks, brief social messages, or requests outside the business scope.',
    'Write a concise search query that preserves the customer intent.',
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

const CHAT_TOOLS: OpenAI.Responses.FunctionTool[] = [KNOWLEDGE_SEARCH_TOOL, CATALOG_SEARCH_TOOL];

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
    searchCatalog,
    searchKnowledge,
  }: GenerateResponseInput): Promise<GenerateResponseResult> {
    const startedAt = Date.now();

    try {
      const initialInput = this.buildInput(message, history);
      const initialCallStartedAt = Date.now();
      const initialResponse = await this.createResponse({
        instructions,
        input: initialInput,
        toolChoice: 'auto',
      });
      const toolCalls = initialResponse.output.filter(
        (item): item is OpenAI.Responses.ResponseFunctionToolCall => item.type === 'function_call',
      );

      if (toolCalls.length === 0) {
        return this.completeGeneration({
          response: initialResponse,
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
        searchCatalog,
        searchKnowledge,
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
        toolChoice: 'none',
      });

      if (finalResponse.output.some((item) => item.type === 'function_call')) {
        throw new Error('OpenAI requested an additional tool after reaching the tool limit');
      }

      return this.completeGeneration({
        response: finalResponse,
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
          : failure.failureCode === 'OPENAI_REQUEST_FAILED'
            ? 'openai.response.failed'
            : 'openai.tool.failed';
      this.logger.error({
        event,
        ...context,
        durationMs: Date.now() - startedAt,
        failureCode: failure.failureCode,
        message,
      });
      throw failure;
    }
  }

  private buildInput(
    message: string,
    history: ChatHistoryMessage[],
  ): OpenAI.Responses.ResponseInput {
    return [
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
    toolChoice,
  }: {
    instructions: string;
    input: OpenAI.Responses.ResponseInput;
    toolChoice: 'auto' | 'none';
  }): Promise<OpenAI.Responses.Response> {
    return this.client.responses.create({
      model: this.config.get<string>('OPENAI_MODEL', 'gpt-5.6-luna'),
      instructions,
      input,
      tools: CHAT_TOOLS,
      tool_choice: toolChoice,
      parallel_tool_calls: false,
      store: false,
      prompt_cache_options: { mode: 'explicit' },
      reasoning: { effort: 'low' },
      max_output_tokens: this.config.get<number>('OPENAI_MAX_OUTPUT_TOKENS', 500),
      text: { format: CHAT_RESPONSE_FORMAT },
    });
  }

  private completeGeneration({
    response,
    businessContext,
    context,
    phase,
    callStartedAt,
    totalStartedAt,
    llmCalls,
    usedTools,
  }: {
    response: OpenAI.Responses.Response;
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
      inputTokens: response.usage?.input_tokens,
      cachedInputTokens: response.usage?.input_tokens_details.cached_tokens,
      cacheWriteTokens: response.usage?.input_tokens_details.cache_write_tokens,
      outputTokens: response.usage?.output_tokens,
      reasoningTokens: response.usage?.output_tokens_details.reasoning_tokens,
      totalTokens: response.usage?.total_tokens,
      reportedSourceIds,
    });

    return {
      answer: generatedResponse.answer,
      usedSources,
      llmCalls,
      usedTools,
    };
  }

  private executeToolCall({
    toolCall,
    searchCatalog,
    searchKnowledge,
  }: {
    toolCall: OpenAI.Responses.ResponseFunctionToolCall;
    searchCatalog: (filters: CatalogSearchArguments) => Promise<string>;
    searchKnowledge: (query: string) => Promise<string>;
  }): Promise<string> {
    switch (toolCall.name) {
      case KNOWLEDGE_SEARCH_TOOL_NAME: {
        const { query } = this.parseKnowledgeSearchArguments(toolCall.arguments);
        return searchKnowledge(query);
      }
      case CATALOG_SEARCH_TOOL_NAME:
        return searchCatalog(this.parseCatalogSearchArguments(toolCall.arguments));
      default:
        throw new Error(`OpenAI requested an unsupported tool: ${toolCall.name}`);
    }
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
      answer: parsed.answer,
      usedSourceIds: parsed.usedSourceIds,
    };
  }

  private getAvailableSources(businessContext: string): Map<string, RagSourceReference> {
    const parsed: unknown = JSON.parse(businessContext);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      (!('knowledge' in parsed) && !('products' in parsed)) ||
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
