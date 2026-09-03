import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DocumentChatContent } from '../chat/chat.types';
import type { CatalogDocumentConfig } from './catalog-document.config';

export type { CatalogDocumentConfig } from './catalog-document.config';

/** Every business serves a single PDF menu at this route (see `CatalogDocumentController`). */
const MENU_DOCUMENT_URL = '/api/menu';
const MENU_DOCUMENT_MIME_TYPE = 'application/pdf' as const;

@Injectable()
export class CatalogDocumentService {
  private readonly document: CatalogDocumentConfig;

  constructor(config: ConfigService) {
    this.document = config.getOrThrow<CatalogDocumentConfig>('catalogDocument');
  }

  getDescriptor(): DocumentChatContent {
    return {
      type: 'document',
      title: this.document.title,
      url: MENU_DOCUMENT_URL,
      mimeType: MENU_DOCUMENT_MIME_TYPE,
    };
  }

  readDocument(): Promise<Buffer> {
    return readFile(resolve(process.cwd(), this.document.path));
  }
}
