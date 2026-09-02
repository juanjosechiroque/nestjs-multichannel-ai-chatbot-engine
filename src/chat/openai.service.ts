import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import {
  ApplicationServiceUnavailableException,
  OpenAiEmptyResponseException,
  OpenAiIncompleteResponseException,
  OpenAiRequestFailedException,
} from '../common/application-error';
import type { RequestContext } from '../common/request-context';
import type { ChatHistoryMessage } from '../memory/memory.types';
import type { RagSourceReference } from '../rag/rag.types';
import type { ChatContent } from './chat.types';
import {
  CHAT_RESPONSE_FORMAT,
  getAvailableSources,
  getContent,
  parseResponse,
} from './chat-response.parser';
import { addTokenUsage, type TokenUsage } from './token-usage';
import { CHAT_TOOLS, type ChatTool, type ToolInvocationContext } from './tools/chat-tool';
import type { OrderConversationContext } from './tools/order.tool';

export interface GenerateResponseInput {
  context: RequestContext;
  message: string;
  instructions: string;
  history: ChatHistoryMessage[];
  orderContext: OrderConversationContext;
  conversationId: string;
  toolChoice: OpenAI.Responses.ToolChoiceOptions | OpenAI.Responses.ToolChoiceFunction;
  knowledgeQueryOverride?: string;
  tools?: readonly ChatTool[];
}

export interface GenerateResponseResult {
  answer: string;
  usedSources: RagSourceReference[];
  llmCalls: number;
  usedTools: string[];
  tokenUsage?: TokenUsage;
  content?: ChatContent[];
}

const EMPTY_BUSINESS_CONTEXT = JSON.stringify({
  retrievalStatus: 'no_results',
  knowledge: [],
});

@Injectable()
export class OpenAiService {
  private readonly client: OpenAI;
  private readonly logger = new Logger(OpenAiService.name);
  private readonly toolsByName: Map<string, ChatTool>;

  constructor(
    private readonly config: ConfigService,
    @Inject(CHAT_TOOLS) private readonly tools: ChatTool[],
  ) {
    this.client = new OpenAI({
      apiKey: this.config.getOrThrow<string>('OPENAI_API_KEY'),
      timeout: this.config.get<number>('OPENAI_GENERATION_TIMEOUT_MS', 20_000),
      maxRetries: this.config.get<number>('OPENAI_GENERATION_MAX_RETRIES', 1),
    });
    this.toolsByName = new Map(tools.map((tool) => [tool.name, tool]));
  }

  async generate({
    context,
    message,
    instructions,
    history,
    orderContext,
    conversationId,
    toolChoice,
    knowledgeQueryOverride,
    tools: toolsOverride,
  }: GenerateResponseInput): Promise<GenerateResponseResult> {
    const startedAt = Date.now();
    const registry = toolsOverride ?? this.tools;
    const toolsByName = toolsOverride
      ? new Map(toolsOverride.map((tool) => [tool.name, tool]))
      : this.toolsByName;

    try {
      const initialInput = this.buildInput(message, history, orderContext);
      const tools = registry.flatMap((tool) => {
        const definition = tool.buildDefinition({ orderContext });
        return definition ? [definition] : [];
      });
      const initialCallStartedAt = Date.now();
      const initialResponse = await this.createResponse({
        instructions,
        input: initialInput,
        tools,
        toolChoice,
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

      const toolOutput = await this.runToolCall(toolCall, toolsByName, {
        requestContext: context,
        conversationId,
        orderContext,
        message,
        ...(knowledgeQueryOverride ? { argumentOverride: knowledgeQueryOverride } : {}),
      });
      const finalCallStartedAt = Date.now();
      const finalResponse = await this.createResponse({
        instructions,
        input: this.buildContinuationInput(initialInput, initialResponse, toolCall, toolOutput),
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
      this.raiseProviderFailure(error, context, startedAt);
    }
  }

  private runToolCall(
    toolCall: OpenAI.Responses.ResponseFunctionToolCall,
    toolsByName: Map<string, ChatTool>,
    invocationContext: ToolInvocationContext,
  ): Promise<string> {
    const tool = toolsByName.get(toolCall.name);
    if (!tool) {
      throw new Error(`OpenAI requested an unsupported tool: ${toolCall.name}`);
    }

    return tool.execute(tool.parseArguments(toolCall.arguments), invocationContext);
  }

  private buildContinuationInput(
    initialInput: OpenAI.Responses.ResponseInput,
    initialResponse: OpenAI.Responses.Response,
    toolCall: OpenAI.Responses.ResponseFunctionToolCall,
    toolOutput: string,
  ): OpenAI.Responses.ResponseInput {
    // The Responses API requires replaying every output item. The SDK models a few
    // output-only status variants more broadly than its input union, so bridge them via unknown.
    const continuationItems = initialResponse.output as unknown as OpenAI.Responses.ResponseInput;

    return [
      ...initialInput,
      ...continuationItems,
      { type: 'function_call_output', call_id: toolCall.call_id, output: toolOutput },
    ];
  }

  private raiseProviderFailure(error: unknown, context: RequestContext, startedAt: number): never {
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

    const generatedResponse = parseResponse(response.output_text);
    if (generatedResponse.answer.trim().length === 0) {
      throw new OpenAiEmptyResponseException();
    }
    const availableSources = getAvailableSources(businessContext);
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
      ...getContent(businessContext),
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
}
