import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';
import {
  DatabaseUnavailableException,
  OpenAiEmptyResponseException,
  OpenAiRequestFailedException,
} from '../common/application-error';
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
    searchKnowledge: jest.fn(),
    ...overrides,
  };
}

function structuredResponse(answer: string, usedSourceIds: string[] = []) {
  return JSON.stringify({ answer, usedSourceIds });
}

function createService(): { service: OpenAiService; create: jest.Mock } {
  const service = new OpenAiService(
    new ConfigService({
      OPENAI_API_KEY: 'test-api-key',
      OPENAI_MODEL: 'gpt-5.6-luna',
      OPENAI_MAX_OUTPUT_TOKENS: 500,
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
        max_output_tokens: 500,
      }),
    );
    expect(initialRequest?.tools).toHaveLength(1);
    expect(initialRequest?.tools?.[0]).toEqual(
      expect.objectContaining({
        type: 'function',
        name: 'search_knowledge',
        strict: true,
      }),
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
    });

    expect(searchKnowledge).toHaveBeenCalledTimes(1);
    expect(searchKnowledge).toHaveBeenCalledWith('horario de atención');
    expect(create).toHaveBeenCalledTimes(2);
    expect(responseRequest(create, 1)).toEqual(
      expect.objectContaining({
        tool_choice: 'none',
        parallel_tool_calls: false,
        input: [
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
    });
    expect(warn).toHaveBeenCalledWith({
      event: 'openai.response.invalid_source_ids',
      requestId: 'request-1',
      conversationId: 'conversation-1',
      channel: 'web',
      invalidSourceIds: ['invented-source'],
    });
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
});
