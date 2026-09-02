import type { KnowledgeSourceType, RagSourceReference } from '../rag/rag.types';
import type { ChatContent, DocumentChatContent } from './chat.types';

export interface StructuredChatResponse {
  answer: string;
  usedSourceIds: string[];
}

export const CHAT_RESPONSE_FORMAT = {
  type: 'json_schema' as const,
  name: 'chat_response',
  strict: true,
  schema: {
    type: 'object',
    properties: {
      answer: {
        type: 'string',
        description: 'The customer-facing answer.',
      },
      usedSourceIds: {
        type: 'array',
        description: 'Identifiers of business-tool items that directly support the answer.',
        items: { type: 'string' },
      },
    },
    required: ['answer', 'usedSourceIds'],
    additionalProperties: false,
  },
};

export function parseResponse(outputText: string): StructuredChatResponse {
  const parsed: unknown = JSON.parse(outputText);

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('answer' in parsed) ||
    typeof parsed.answer !== 'string' ||
    !('usedSourceIds' in parsed) ||
    !Array.isArray(parsed.usedSourceIds) ||
    !parsed.usedSourceIds.every((sourceId) => typeof sourceId === 'string')
  ) {
    throw new Error('OpenAI returned an invalid structured response');
  }

  return {
    answer: parsed.answer.replaceAll('\\n', '\n'),
    usedSourceIds: parsed.usedSourceIds,
  };
}

export function getContent(businessContext: string): { content?: ChatContent[] } {
  const parsed: unknown = JSON.parse(businessContext);

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('documentStatus' in parsed) ||
    parsed.documentStatus !== 'available' ||
    !('document' in parsed) ||
    !isDocumentContent(parsed.document)
  ) {
    return {};
  }

  return { content: [parsed.document] };
}

function isDocumentContent(value: unknown): value is DocumentChatContent {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'document' &&
    'title' in value &&
    typeof value.title === 'string' &&
    'url' in value &&
    typeof value.url === 'string' &&
    'mimeType' in value &&
    value.mimeType === 'application/pdf'
  );
}

export function getAvailableSources(businessContext: string): Map<string, RagSourceReference> {
  const parsed: unknown = JSON.parse(businessContext);

  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    (!('knowledge' in parsed) &&
      !('products' in parsed) &&
      !('currentPromotions' in parsed) &&
      !('orderOperationStatus' in parsed) &&
      !('documentStatus' in parsed)) ||
    ('knowledge' in parsed && !Array.isArray(parsed.knowledge)) ||
    ('products' in parsed && !Array.isArray(parsed.products)) ||
    ('currentPromotions' in parsed && !Array.isArray(parsed.currentPromotions)) ||
    ('otherPromotions' in parsed && !Array.isArray(parsed.otherPromotions))
  ) {
    throw new Error('Business context has an invalid structure');
  }

  const knowledge: unknown[] =
    'knowledge' in parsed && Array.isArray(parsed.knowledge) ? parsed.knowledge : [];
  const products: unknown[] =
    'products' in parsed && Array.isArray(parsed.products) ? parsed.products : [];
  const currentPromotions: unknown[] =
    'currentPromotions' in parsed && Array.isArray(parsed.currentPromotions)
      ? parsed.currentPromotions
      : [];
  const otherPromotions: unknown[] =
    'otherPromotions' in parsed && Array.isArray(parsed.otherPromotions)
      ? parsed.otherPromotions
      : [];

  return new Map<string, RagSourceReference>(
    [...knowledge, ...products, ...currentPromotions, ...otherPromotions].flatMap(
      (item): Array<[string, RagSourceReference]> => {
        if (
          typeof item === 'object' &&
          item !== null &&
          'sourceId' in item &&
          typeof item.sourceId === 'string' &&
          'sourceKey' in item &&
          typeof item.sourceKey === 'string' &&
          'type' in item &&
          isKnowledgeSourceType(item.type)
        ) {
          return [
            [
              item.sourceId,
              {
                sourceId: item.sourceId,
                sourceKey: item.sourceKey,
                sourceType: item.type,
              },
            ],
          ];
        }

        return [];
      },
    ),
  );
}

function isKnowledgeSourceType(value: unknown): value is KnowledgeSourceType {
  return (
    value === 'product' || value === 'product_category' || value === 'promotion' || value === 'faq'
  );
}
