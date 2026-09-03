import { Controller, Get, Header, StreamableFile } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../common/api-error-response.dto';
import { CatalogDocumentService } from './catalog-document.service';

@ApiTags('Catalog')
@Controller()
export class CatalogDocumentController {
  constructor(private readonly catalogDocument: CatalogDocumentService) {}

  @Get('menu')
  @ApiOperation({ summary: 'Open the configured business menu PDF' })
  @ApiOkResponse({
    description: 'Menu PDF',
    content: { 'application/pdf': { schema: { type: 'string', format: 'binary' } } },
  })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  @Header('Content-Type', 'application/pdf')
  @Header('Content-Disposition', 'inline; filename="menu.pdf"')
  async getMenu(): Promise<StreamableFile> {
    return new StreamableFile(await this.catalogDocument.readDocument());
  }
}
