import type OpenAI from 'openai';

const KNOWLEDGE_SEARCH_TOOL_NAME = 'search_knowledge';
const PROMOTION_SEARCH_TOOL_NAME = 'search_promotions';
const DIACRITIC_PATTERN = /[\u0300-\u036f]/g;

export interface ToolRouting {
  toolChoice: OpenAI.Responses.ToolChoiceOptions | OpenAI.Responses.ToolChoiceFunction;
  knowledgeQueryOverride?: string;
}

export function routeToolChoice(message: string): ToolRouting {
  const locationKnowledgeRequest = isLocationKnowledgeRequest(message);
  const servicesKnowledgeRequest = isServicesKnowledgeRequest(message);
  const promotionRequest = isPromotionRequest(message);
  const forceKnowledgeSearch =
    !promotionRequest && (locationKnowledgeRequest || servicesKnowledgeRequest);
  const knowledgeQueryOverride = locationKnowledgeRequest
    ? `dirección exacta, ubicación, cómo llegar y enlace de mapa. Pregunta del cliente: ${message}`
    : servicesKnowledgeRequest
      ? message
      : undefined;
  const toolChoice: ToolRouting['toolChoice'] = promotionRequest
    ? { type: 'function', name: PROMOTION_SEARCH_TOOL_NAME }
    : forceKnowledgeSearch
      ? { type: 'function', name: KNOWLEDGE_SEARCH_TOOL_NAME }
      : 'auto';

  return {
    toolChoice,
    ...(knowledgeQueryOverride ? { knowledgeQueryOverride } : {}),
  };
}

function normalize(message: string): string {
  return message.normalize('NFD').replace(DIACRITIC_PATTERN, '').toLowerCase();
}

function isLocationKnowledgeRequest(message: string): boolean {
  const normalizedMessage = normalize(message);
  const hasExplicitLocationTerm =
    /\b(direccion|ubicacion|domicilio|sede|sedes|sucursal|sucursales)\b/.test(normalizedMessage);
  const asksWhere = /\b(donde|como llego|como llegar)\b/.test(normalizedMessage);
  const mentionsBusinessPlace = /\b(cafe|cafeteria|local|locales|queda|ubicad[oa]s?)\b/.test(
    normalizedMessage,
  );

  return hasExplicitLocationTerm || (asksWhere && mentionsBusinessPlace);
}

function isServicesKnowledgeRequest(message: string): boolean {
  return /\b(servicio|servicios|facilidad|facilidades|comodidad|comodidades)\b/.test(
    normalize(message),
  );
}

function isPromotionRequest(message: string): boolean {
  return /\b(promocion|promociones|promo|promos|oferta|ofertas|descuento|descuentos|2x1)\b/.test(
    normalize(message),
  );
}
