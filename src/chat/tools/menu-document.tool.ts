import { Inject, Injectable } from '@nestjs/common';
import type OpenAI from 'openai';
import { CatalogDocumentService } from '../../catalog/catalog-document.service';
import type { ChatTool, ToolInvocationContext } from './chat-tool';

const MENU_DOCUMENT_TOOL_NAME = 'get_menu_document';

@Injectable()
export class MenuDocumentTool implements ChatTool<void> {
  readonly name = MENU_DOCUMENT_TOOL_NAME;

  constructor(
    @Inject(CatalogDocumentService)
    private readonly catalogDocument: Pick<CatalogDocumentService, 'getDescriptor'>,
  ) {}

  buildDefinition(): OpenAI.Responses.FunctionTool {
    return {
      type: 'function',
      name: MENU_DOCUMENT_TOOL_NAME,
      description: [
        "Get the current business's customer-facing menu document.",
        'Use it when the customer explicitly asks to see, open, download, receive, or view the menu or full menu.',
        'Do not use it for broad discovery questions such as what the business sells, or for product category, price, preference, allergen, or order questions.',
        'The document is a presentation resource; use search_catalog for structured product facts and manage_order for order operations.',
      ].join(' '),
      parameters: {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      },
      strict: true,
    };
  }

  parseArguments(argumentsJson: string): void {
    const parsed: unknown = JSON.parse(argumentsJson);

    if (typeof parsed !== 'object' || parsed === null || Object.keys(parsed).length > 0) {
      throw new Error(`OpenAI returned invalid ${MENU_DOCUMENT_TOOL_NAME} arguments`);
    }
  }

  execute(_args?: void, _context?: ToolInvocationContext): Promise<string> {
    return Promise.resolve(
      JSON.stringify({
        documentStatus: 'available',
        document: this.catalogDocument.getDescriptor(),
      }),
    );
  }
}
