import { Controller, Get } from '@nestjs/common';
import { CatalogService } from './catalog.service';

@Controller()
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get('products')
  getProducts() {
    return this.catalogService.getProducts();
  }

  @Get('promotions')
  getPromotions() {
    return this.catalogService.getPromotions();
  }

  @Get('faqs')
  getFaqs() {
    return this.catalogService.getFaqs();
  }
}
