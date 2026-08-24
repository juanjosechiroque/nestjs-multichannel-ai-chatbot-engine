import { ConfigService } from '@nestjs/config';
import { CatalogDocumentService } from './catalog-document.service';

describe('CatalogDocumentService', () => {
  const config = {
    title: 'Carta de Café Nube',
    path: 'examples/cafe-nube/assets/menu.pdf',
    url: '/api/menu',
    mimeType: 'application/pdf' as const,
  };

  function createService(): CatalogDocumentService {
    return new CatalogDocumentService(new ConfigService({ catalogDocument: config }));
  }

  it('builds a channel-neutral menu descriptor from the business example configuration', () => {
    const service = createService();

    expect(service.getDescriptor()).toEqual({
      type: 'document',
      title: 'Carta de Café Nube',
      url: '/api/menu',
      mimeType: 'application/pdf',
    });
  });

  it('reads the configured example document', async () => {
    const service = createService();

    await expect(service.readDocument()).resolves.toEqual(expect.any(Buffer));
  });
});
