import type { BusinessProfile } from '../../business/contract';
import { businessProfile } from '../../business/profile';
import type { CatalogDocumentConfig } from '../catalog/catalog-document.config';

/** Every deployment ships its menu here; see `business/README.md`. */
const MENU_DOCUMENT_PATH = 'business/assets/menu.pdf';

/** The menu document title, defaulting to `Carta de <name>` when unset. */
export function resolveMenuTitle(profile: Pick<BusinessProfile, 'name' | 'menuTitle'>): string {
  return profile.menuTitle ?? `Carta de ${profile.name}`;
}

/**
 * Configuration derived from `business/profile.json`.
 *
 * This is the only seam between the engine and the `business/` folder: it exposes
 * the business identity under the keys the conversational core already consumes
 * (`ChatService`, `PromotionSearchTool`, `CatalogDocumentService`). There is no
 * runtime selector — the deployment serves exactly one business.
 */
export interface BusinessConfig {
  BUSINESS_NAME: string;
  BUSINESS_TIME_ZONE: string;
  catalogDocument: CatalogDocumentConfig;
}

/** `ConfigModule` `load` factory. */
export function loadBusinessConfig(): BusinessConfig {
  return {
    BUSINESS_NAME: businessProfile.name,
    BUSINESS_TIME_ZONE: businessProfile.timeZone,
    catalogDocument: {
      title: resolveMenuTitle(businessProfile),
      path: MENU_DOCUMENT_PATH,
    },
  };
}
