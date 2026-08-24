import { Inject, Injectable } from '@nestjs/common';
import { CatalogDocumentService } from '../../catalog/catalog-document.service';

@Injectable()
export class MenuDocumentTool {
  constructor(
    @Inject(CatalogDocumentService)
    private readonly catalogDocument: Pick<CatalogDocumentService, 'getDescriptor'>,
  ) {}

  execute(): Promise<string> {
    return Promise.resolve(
      JSON.stringify({
        documentStatus: 'available',
        document: this.catalogDocument.getDescriptor(),
      }),
    );
  }
}
