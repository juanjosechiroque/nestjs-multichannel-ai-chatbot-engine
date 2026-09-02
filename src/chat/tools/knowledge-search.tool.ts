import { Inject, Injectable } from '@nestjs/common';
import type OpenAI from 'openai';
import { RagService } from '../../rag/rag.service';
import type { ChatTool, ToolInvocationContext } from './chat-tool';

const RAG_TOP_K = 5;
const KNOWLEDGE_SEARCH_TOOL_NAME = 'search_knowledge';

export interface KnowledgeSearchArguments {
  query: string;
}

@Injectable()
export class KnowledgeSearchTool implements ChatTool<KnowledgeSearchArguments> {
  readonly name = KNOWLEDGE_SEARCH_TOOL_NAME;

  constructor(
    @Inject(RagService)
    private readonly rag: Pick<RagService, 'getContext'>,
  ) {}

  buildDefinition(): OpenAI.Responses.FunctionTool {
    return {
      type: 'function',
      name: KNOWLEDGE_SEARCH_TOOL_NAME,
      description: [
        "Search the current business's confirmed knowledge base.",
        'Use it before answering factual questions about FAQs, location, hours, policies, or confirmed services.',
        'Use search_promotions instead for current, scheduled, or named promotions.',
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
  }

  parseArguments(argumentsJson: string): KnowledgeSearchArguments {
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

  async execute(args: KnowledgeSearchArguments, context: ToolInvocationContext): Promise<string> {
    const normalizedQuery = (context.argumentOverride ?? args.query).trim();
    if (normalizedQuery.length === 0) {
      throw new RangeError('Knowledge search query cannot be empty');
    }

    return this.rag.getContext(normalizedQuery, RAG_TOP_K, context.requestContext);
  }
}
