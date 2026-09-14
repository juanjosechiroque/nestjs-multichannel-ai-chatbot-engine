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

  it('describes a no-argument function tool', () => {
    const definition = new MenuDocumentTool({ getDescriptor: jest.fn() }).buildDefinition();

    expect(definition).toEqual(
      expect.objectContaining({ type: 'function', name: 'get_menu_document', strict: true }),
    );
    expect(definition.parameters).toEqual({
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    });
  });

  it('accepts an empty argument object and rejects any property', () => {
    const tool = new MenuDocumentTool({ getDescriptor: jest.fn() });

    expect(() => tool.parseArguments('{}')).not.toThrow();
    expect(() => tool.parseArguments('{"unexpected":true}')).toThrow(
      'OpenAI returned invalid get_menu_document arguments',
    );
    expect(() => tool.parseArguments('"not-an-object"')).toThrow(
      'OpenAI returned invalid get_menu_document arguments',
    );
  });
});
