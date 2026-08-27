export type PromotionSearchScope = 'CURRENT' | 'CATALOG';

export interface PromotionSearchFilters {
  promotionName?: string;
  evaluatedAt: Date;
  includeNotStarted: boolean;
}

export interface PromotionSchedule {
  days: string[];
  startTime: string | null;
  endTime: string | null;
}
