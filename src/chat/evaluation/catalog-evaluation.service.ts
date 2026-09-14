import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { routeToolChoice } from '../chat-tool-router';
import { OpenAiService } from '../openai.service';
import { buildSystemPrompt } from '../prompts/system-prompt';
import type { CatalogSearchArguments } from '../tools/catalog-search.tool';
import {
  CHAT_TOOLS,
  type ChatTool,
  type ToolBuildContext,
  type ToolInvocationContext,
} from '../tools/chat-tool';
import type {
  CatalogEvaluationCase,
  CatalogEvaluationReport,
  CatalogEvaluationResult,
} from './catalog-evaluation.types';

const EMPTY_KNOWLEDGE_RESULT = JSON.stringify({
  retrievalStatus: 'no_results',
  knowledge: [],
});

class RecordingCatalogTool implements ChatTool {
  applied: CatalogSearchArguments | null = null;

  constructor(private readonly inner: ChatTool) {}

  get name(): string {
    return this.inner.name;
  }

  buildDefinition(context: ToolBuildContext) {
    return this.inner.buildDefinition(context);
  }

  parseArguments(argumentsJson: string): unknown {
    const args = this.inner.parseArguments(argumentsJson);
    this.applied = args as CatalogSearchArguments;
    return args;
  }

  execute(args: unknown, context: ToolInvocationContext): Promise<string> {
    return this.inner.execute(args, context);
  }
}

class UnavailableTool implements ChatTool {
  constructor(
    private readonly inner: ChatTool,
    private readonly outcome: () => Promise<string>,
  ) {}

  get name(): string {
    return this.inner.name;
  }

  buildDefinition(context: ToolBuildContext) {
    return this.inner.buildDefinition(context);
  }

  parseArguments(argumentsJson: string): unknown {
    return this.inner.parseArguments(argumentsJson);
  }

  execute(): Promise<string> {
    return this.outcome();
  }
}

@Injectable()
export class CatalogEvaluationService {
  private readonly instructions: string;

  constructor(
    @Inject(OpenAiService)
    private readonly openAi: Pick<OpenAiService, 'generate'>,
    @Inject(CHAT_TOOLS)
    private readonly chatTools: ChatTool[],
    config: ConfigService,
  ) {
    this.instructions = buildSystemPrompt({
      businessName: config.getOrThrow<string>('BUSINESS_NAME'),
    });
  }

  private buildEvaluationTools(): { tools: ChatTool[]; recorder: RecordingCatalogTool } {
    const catalogTool = this.chatTools.find((tool) => tool.name === 'search_catalog');
    if (!catalogTool) {
      throw new Error('The catalog search tool is not registered');
    }
    const recorder = new RecordingCatalogTool(catalogTool);
    const tools = this.chatTools.map((tool) => {
      if (tool.name === 'search_catalog') {
        return recorder;
      }
      if (tool.name === 'search_knowledge') {
        return new UnavailableTool(tool, () => Promise.resolve(EMPTY_KNOWLEDGE_RESULT));
      }
      return new UnavailableTool(tool, () =>
        Promise.reject(new Error(`${tool.name} is unavailable in catalog evals`)),
      );
    });

    return { tools, recorder };
  }

  async evaluate(
    evaluationCases: readonly CatalogEvaluationCase[],
  ): Promise<CatalogEvaluationReport> {
    this.validateCases(evaluationCases);
    const results: CatalogEvaluationResult[] = [];

    for (const evaluationCase of evaluationCases) {
      const context = {
        requestId: `catalog-eval-${randomUUID()}`,
        conversationId: `catalog-eval-${randomUUID()}`,
        channel: 'evaluation',
      };
      const routing = routeToolChoice(evaluationCase.message);
      const { tools, recorder } = this.buildEvaluationTools();
      const generation = await this.openAi.generate({
        context,
        message: evaluationCase.message,
        instructions: this.instructions,
        history: [],
        orderContext: { activeOrder: null, confirmationReplayAvailable: false },
        conversationId: context.conversationId,
        toolChoice: routing.toolChoice,
        ...(routing.knowledgeQueryOverride
          ? { knowledgeQueryOverride: routing.knowledgeQueryOverride }
          : {}),
        tools,
      });
      const appliedFilters = recorder.applied;
      const usedSourceKeys = generation.usedSources.map((source) => source.sourceKey);
      const failures = this.getFailures(
        evaluationCase,
        generation.usedTools,
        usedSourceKeys,
        appliedFilters,
      );

      results.push({
        ...evaluationCase,
        answer: generation.answer,
        usedTools: generation.usedTools,
        usedSourceKeys,
        appliedFilters,
        passed: failures.length === 0,
        reason: failures.length === 0 ? 'Expected catalog sources were used.' : failures.join(' '),
      });
    }

    const passed = results.filter((result) => result.passed).length;

    return {
      total: results.length,
      passed,
      failed: results.length - passed,
      passRate: Number(((passed / results.length) * 100).toFixed(2)),
      results,
    };
  }

  private validateCases(evaluationCases: readonly CatalogEvaluationCase[]): void {
    if (evaluationCases.length === 0) {
      throw new RangeError('At least one catalog evaluation case is required');
    }

    const names = new Set(evaluationCases.map((evaluationCase) => evaluationCase.name));
    if (names.size !== evaluationCases.length) {
      throw new RangeError('Catalog evaluation case names must be unique');
    }

    if (evaluationCases.some((evaluationCase) => evaluationCase.expectedSourceKeys.length === 0)) {
      throw new RangeError('Every catalog evaluation case requires an expected source');
    }
  }

  private getFailures(
    evaluationCase: CatalogEvaluationCase,
    usedTools: readonly string[],
    usedSourceKeys: readonly string[],
    appliedFilters: CatalogSearchArguments | null,
  ): string[] {
    const failures: string[] = [];

    if (usedTools.length !== 1 || usedTools[0] !== 'search_catalog') {
      failures.push(`Expected search_catalog but used: ${usedTools.join(', ') || 'no tool'}.`);
    }

    const filterEntries = Object.entries(evaluationCase.expectedFilters) as Array<
      [keyof CatalogSearchArguments, CatalogSearchArguments[keyof CatalogSearchArguments]]
    >;
    for (const [filterName, expectedValue] of filterEntries) {
      const appliedValue = appliedFilters?.[filterName];
      if (!this.filterValuesMatch(expectedValue, appliedValue)) {
        failures.push(
          `Expected filter ${filterName}=${JSON.stringify(expectedValue)} but received ${JSON.stringify(appliedValue)}.`,
        );
      }
    }

    const missing = evaluationCase.expectedSourceKeys.filter(
      (sourceKey) => !usedSourceKeys.includes(sourceKey),
    );
    if (missing.length > 0) {
      failures.push(`Missing expected sources: ${missing.join(', ')}.`);
    }

    const forbidden = (evaluationCase.forbiddenSourceKeys ?? []).filter((sourceKey) =>
      usedSourceKeys.includes(sourceKey),
    );
    if (forbidden.length > 0) {
      failures.push(`Used forbidden sources: ${forbidden.join(', ')}.`);
    }

    return failures;
  }

  private filterValuesMatch(
    expected: CatalogSearchArguments[keyof CatalogSearchArguments],
    applied: CatalogSearchArguments[keyof CatalogSearchArguments] | undefined,
  ): boolean {
    if (Array.isArray(expected)) {
      const appliedValues: readonly unknown[] = Array.isArray(applied) ? applied : [];
      return (
        Array.isArray(applied) &&
        expected.length === appliedValues.length &&
        expected.every((value) => appliedValues.includes(value))
      );
    }

    return expected === applied;
  }
}
