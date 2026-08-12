import type { CatalogDocumentService } from '../../catalog/catalog-document.service';
import { MenuDocumentTool } from './menu-document.tool';

describe('MenuDocumentTool', () => {
  it('returns a channel-neutral PDF descriptor without catalog products', async () => {
    const getDescriptor = jest.fn().mockReturnValue({
      type: 'document',
      title: 'Carta de Café Nube',
      url: '/api/menu',
      mimeType: 'application/pdf',
    });
    const catalogDocument: Pick<CatalogDocumentService, 'getDescriptor'> = { getDescriptor };
    const tool = new MenuDocumentTool(catalogDocument);

    await expect(tool.execute()).resolves.toBe(
      JSON.stringify({
        documentStatus: 'available',
        document: {
          type: 'document',
          title: 'Carta de Café Nube',
          url: '/api/menu',
          mimeType: 'application/pdf',
        },
      }),
    );
    expect(getDescriptor).toHaveBeenCalledTimes(1);
  });
});
