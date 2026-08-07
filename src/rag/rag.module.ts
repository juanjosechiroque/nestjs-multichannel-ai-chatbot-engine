import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { EmbeddingService } from './embedding.service';
import { KnowledgeDocumentFactory } from './knowledge-document.factory';
import { KnowledgeIngestionService } from './knowledge-ingestion.service';
import { RagService } from './rag.service';

@Module({
  imports: [CatalogModule],
  providers: [EmbeddingService, KnowledgeDocumentFactory, KnowledgeIngestionService, RagService],
  exports: [KnowledgeIngestionService, RagService],
})
export class RagModule {}
