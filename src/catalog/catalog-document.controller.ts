import { Controller, Get, Header, StreamableFile } from '@nestjs/common';
import { CatalogDocumentService } from './catalog-document.service';

@Controller()
export class CatalogDocumentController {
  constructor(private readonly catalogDocument: CatalogDocumentService) {}

  @Get('menu')
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'inline; filename="menu.pdf"')
  async getMenu(): Promise<StreamableFile> {
    return new StreamableFile(await this.catalogDocument.readDocument());
  }
}
