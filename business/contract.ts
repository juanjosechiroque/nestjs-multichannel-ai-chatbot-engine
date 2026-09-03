import type { Prisma } from '../src/generated/prisma/client';

/**
 * Runtime identity of the business this deployment serves.
 *
 * Authored in `business/profile.json` (see `business/profile.ts` for loading and
 * validation). It is the single source of truth for the business name, the IANA
 * time zone used to evaluate promotions, and the menu document's title. The menu
 * file is always `business/assets/menu.pdf`, served at `/api/menu` — those are
 * engine constants, not configuration.
 */
export interface BusinessProfile {
  /** Business name injected into the system prompt and menu descriptor. */
  name: string;
  /** IANA time zone (e.g. `America/Lima`) used for promotion schedule rules. */
  timeZone: string;
  /** Menu document title shown to customers. Optional; defaults to `Carta de <name>`. */
  menuTitle?: string;
}

/** A single product/promotion/FAQ record as accepted by Prisma's create input. */
export type ProductSeed = Prisma.ProductCreateInput;
export type PromotionSeed = Prisma.PromotionCreateInput;
export type FaqSeed = Prisma.FaqCreateInput;

/**
 * Reproducible bootstrap data for the business.
 *
 * Records are upserted by their stable `slug`, so re-running the seed is
 * idempotent. `obsoleteFaqSlugs` lists FAQ slugs published by earlier versions of
 * this business that must be removed on reseed. PostgreSQL is the runtime source
 * of truth; this data is only the reproducible initial load.
 */
export interface BusinessSeed {
  products: readonly ProductSeed[];
  promotions: readonly PromotionSeed[];
  faqs: readonly FaqSeed[];
  obsoleteFaqSlugs: readonly string[];
}
