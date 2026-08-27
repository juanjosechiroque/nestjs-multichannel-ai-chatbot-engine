import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CatalogService } from '../../catalog/catalog.service';
import { getPromotionSchedule, isPromotionCurrent } from '../../catalog/promotion-schedule';
import type { PromotionSearchScope } from '../../catalog/promotion.types';
import type { RequestContext } from '../../common/request-context';

export interface PromotionSearchArguments {
  scope: PromotionSearchScope;
  promotionName: string | null;
}

export interface PromotionSearchInput extends PromotionSearchArguments {
  context: RequestContext;
}

@Injectable()
export class PromotionSearchTool {
  private readonly timeZone: string;

  constructor(
    @Inject(CatalogService)
    private readonly catalog: Pick<CatalogService, 'searchPromotions'>,
    config: ConfigService,
  ) {
    this.timeZone = config.getOrThrow<string>('BUSINESS_TIME_ZONE');
  }

  async execute(input: PromotionSearchInput, evaluatedAt = new Date()): Promise<string> {
    const promotions = await this.catalog.searchPromotions(
      {
        ...(input.promotionName ? { promotionName: input.promotionName } : {}),
        evaluatedAt,
        includeNotStarted: input.scope === 'CATALOG',
      },
      input.context,
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
        input.scope === 'CURRENT'
          ? currentPromotions.length > 0
            ? 'current_promotions_found'
            : 'no_current_promotions'
          : classified.length > 0
            ? 'catalog_results_found'
            : 'no_promotions',
      scope: input.scope,
      evaluatedAt: evaluatedAt.toISOString(),
      timeZone: this.timeZone,
      currentPromotions,
      ...(input.scope === 'CATALOG' ? { otherPromotions } : {}),
    });
  }

  private getPromotionTerms(metadata: unknown): Record<string, unknown> {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return {};

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
      if (typeof values[key] === 'string') terms[key] = values[key];
    }
    for (const key of stringArrayKeys) {
      const value = values[key];
      if (Array.isArray(value) && value.every((item) => typeof item === 'string')) {
        terms[key] = value;
      }
    }
    if (typeof values.stackable === 'boolean') terms.stackable = values.stackable;

    return terms;
  }
}
