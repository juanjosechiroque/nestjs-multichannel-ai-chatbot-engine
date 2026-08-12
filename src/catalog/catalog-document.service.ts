import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { DocumentChatContent } from '../chat/chat.types';

export interface CatalogDocumentConfig {
  title: string;
  path: string;
  url: string;
  mimeType: DocumentChatContent['mimeType'];
}

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
      url: this.document.url,
      mimeType: this.document.mimeType,
    };
  }

  readDocument(): Promise<Buffer> {
    return readFile(resolve(process.cwd(), this.document.path));
  }
}
