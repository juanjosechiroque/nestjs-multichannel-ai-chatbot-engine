import { ConfigService } from '@nestjs/config';
import { CatalogDocumentService } from './catalog-document.service';

describe('CatalogDocumentService', () => {
  const config = {
    title: 'Carta de Aurora Bistró',
    path: 'test/support/sample-document.pdf',
  };

  function createService(): CatalogDocumentService {
    return new CatalogDocumentService(new ConfigService({ catalogDocument: config }));
  }

  it('builds a channel-neutral menu descriptor with the configured title and engine constants', () => {
    const service = createService();

    expect(service.getDescriptor()).toEqual({
      type: 'document',
      title: 'Carta de Aurora Bistró',
      url: '/api/menu',
      mimeType: 'application/pdf',
    });
  });

  it('reads the configured document from disk', async () => {
    const service = createService();

    await expect(service.readDocument()).resolves.toEqual(expect.any(Buffer));
  });
});
