import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type OpenAI from 'openai';
import { CatalogService } from '../../catalog/catalog.service';
import { getPromotionSchedule, isPromotionCurrent } from '../../catalog/promotion-schedule';
import type { PromotionSearchScope } from '../../catalog/promotion.types';
import type { ChatTool, ToolInvocationContext } from './chat-tool';

const PROMOTION_SEARCH_TOOL_NAME = 'search_promotions';

export interface PromotionSearchArguments {
  scope: PromotionSearchScope;
  promotionName: string | null;
}

@Injectable()
export class PromotionSearchTool implements ChatTool<PromotionSearchArguments> {
  readonly name = PROMOTION_SEARCH_TOOL_NAME;
  private readonly timeZone: string;

  constructor(
    @Inject(CatalogService)
    private readonly catalog: Pick<CatalogService, 'searchPromotions'>,
    config: ConfigService,
  ) {
    this.timeZone = config.getOrThrow<string>('BUSINESS_TIME_ZONE');
  }

  buildDefinition(): OpenAI.Responses.FunctionTool {
    return {
      type: 'function',
      name: PROMOTION_SEARCH_TOOL_NAME,
      description: [
        "Search the current business's promotions using application-controlled date, weekday, time, and time-zone rules.",
        'Use CURRENT when the customer asks which promotions apply now, currently, or today.',
        'Use CATALOG when the customer asks what promotions exist, asks about another time, or requests details about a named promotion.',
        'The application supplies the current instant and business time zone. Never infer promotion validity yourself.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {
          scope: {
            type: 'string',
            enum: ['CURRENT', 'CATALOG'],
            description:
              'Whether to return only currently valid promotions or the published catalog.',
          },
          promotionName: {
            type: ['string', 'null'],
            description: 'Full or partial promotion name, or null when no name filter is needed.',
            minLength: 1,
            maxLength: 100,
          },
        },
        required: ['scope', 'promotionName'],
        additionalProperties: false,
      },
      strict: true,
    };
  }

  parseArguments(argumentsJson: string): PromotionSearchArguments {
    const parsed: unknown = JSON.parse(argumentsJson);

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      !('scope' in parsed) ||
      !('promotionName' in parsed) ||
      Object.keys(parsed).some((key) => key !== 'scope' && key !== 'promotionName')
    ) {
      throw new Error('OpenAI returned invalid search_promotions arguments');
    }

    const scope = parsed.scope;
    const promotionName = parsed.promotionName;
    if (
      !(scope === 'CURRENT' || scope === 'CATALOG') ||
      !(
        promotionName === null ||
        (typeof promotionName === 'string' &&
          promotionName.trim().length > 0 &&
          promotionName.length <= 100)
      )
    ) {
      throw new Error('OpenAI returned invalid search_promotions arguments');
    }

    return {
      scope,
      promotionName: promotionName === null ? null : promotionName.trim(),
    };
  }

  async execute(
    args: PromotionSearchArguments,
    context: ToolInvocationContext,
    evaluatedAt = new Date(),
  ): Promise<string> {
    const promotions = await this.catalog.searchPromotions(
      {
        ...(args.promotionName ? { promotionName: args.promotionName } : {}),
        evaluatedAt,
        includeNotStarted: args.scope === 'CATALOG',
      },
      context.requestContext,
    );
    const classified = promotions.map((promotion) => {
      const isWithinDateWindow =
        (!promotion.startsAt || promotion.startsAt <= evaluatedAt) &&
        (!promotion.endsAt || promotion.endsAt > evaluatedAt);

      return {
        sourceId: promotion.id,
        sourceKey: promotion.slug,
        type: 'promotion' as const,
        name: promotion.name,
        description: promotion.description,
        startsAt: promotion.startsAt?.toISOString() ?? null,
        endsAt: promotion.endsAt?.toISOString() ?? null,
        schedule: {
          ...getPromotionSchedule(promotion.metadata),
          timeZone: this.timeZone,
        },
        terms: this.getPromotionTerms(promotion.metadata),
        currentlyValid:
          isWithinDateWindow && isPromotionCurrent(promotion.metadata, evaluatedAt, this.timeZone),
      };
    });
    const currentPromotions = classified.filter((promotion) => promotion.currentlyValid);
    const otherPromotions = classified.filter((promotion) => !promotion.currentlyValid);

    return JSON.stringify({
      promotionStatus:
        args.scope === 'CURRENT'
          ? currentPromotions.length > 0
            ? 'current_promotions_found'
            : 'no_current_promotions'
          : classified.length > 0
            ? 'catalog_results_found'
            : 'no_promotions',
      scope: args.scope,
      evaluatedAt: evaluatedAt.toISOString(),
      timeZone: this.timeZone,
      currentPromotions,
      ...(args.scope === 'CATALOG' ? { otherPromotions } : {}),
    });
  }

  private getPromotionTerms(metadata: unknown): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return {};
    }

    const values = metadata as Record<string, unknown>;
    const terms: Record<string, unknown> = {};
    const numberKeys = ['discountPercentage', 'buyQuantity', 'payQuantity'] as const;
    const stringKeys = ['promotionalPrice', 'regularPrice', 'alternativeMilkPrice'] as const;
    const stringArrayKeys = [
      'channels',
      'excludedChannels',
      'productSlugs',
      'restrictions',
    ] as const;

    for (const key of numberKeys) {
      if (typeof values[key] === 'number' && Number.isFinite(values[key])) {
        terms[key] = values[key];
      }
    }
    for (const key of stringKeys) {
      if (typeof values[key] === 'string') {
        terms[key] = values[key];
      }
    }
    for (const key of stringArrayKeys) {
      const value = values[key];
      if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
        terms[key] = value;
      }
    }
    if (typeof values.stackable === 'boolean') {
      terms.stackable = values.stackable;
    }

    return terms;
  }
}
