import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { KnowledgeContextService } from './knowledge-context.service';

@Module({
  imports: [CatalogModule],
  providers: [KnowledgeContextService],
  exports: [KnowledgeContextService],
})
export class KnowledgeModule {}
