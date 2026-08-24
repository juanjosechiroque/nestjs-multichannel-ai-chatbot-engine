import { Module } from '@nestjs/common';
import { CatalogDocumentController } from './catalog-document.controller';
import { CatalogDocumentService } from './catalog-document.service';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  controllers: [CatalogController, CatalogDocumentController],
  providers: [CatalogDocumentService, CatalogService],
  exports: [CatalogDocumentService, CatalogService],
})
export class CatalogModule {}
