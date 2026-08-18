import { Controller, Get } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiServiceUnavailableResponse,
  ApiTags,
} from '@nestjs/swagger';
import { ApiErrorResponseDto } from '../common/api-error-response.dto';
import {
  FaqResponseDto,
  ProductResponseDto,
  PromotionResponseDto,
} from './dto/catalog-response.dto';
import { CatalogService } from './catalog.service';

@ApiTags('Catalog')
@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('products')
  @ApiOperation({ summary: 'List active products' })
  @ApiOkResponse({ type: [ProductResponseDto] })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  getProducts() {
    return this.catalogService.getProducts();
  }

  @Get('promotions')
  @ApiOperation({ summary: 'List published promotions' })
  @ApiOkResponse({ type: [PromotionResponseDto] })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  getPromotions() {
    return this.catalogService.getPromotions();
  }

  @Get('faqs')
  @ApiOperation({ summary: 'List published frequently asked questions' })
  @ApiOkResponse({ type: [FaqResponseDto] })
  @ApiServiceUnavailableResponse({ type: ApiErrorResponseDto })
  getFaqs() {
    return this.catalogService.getFaqs();
  }
}
