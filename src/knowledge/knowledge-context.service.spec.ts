import { KnowledgeContextService } from './knowledge-context.service';

describe('KnowledgeContextService', () => {
  it('builds business context using only fields allowed for the model', async () => {
    const catalog = {
      getProducts: jest.fn().mockResolvedValue([
        {
          id: 'private-product-id',
          name: 'Latte Nube',
          description: 'Espresso doble con leche vaporizada.',
          price: '14.00',
          currency: 'PEN',
          category: 'HOT_DRINK',
          metadata: { internalNote: 'do not expose' },
        },
      ]),
      getPromotions: jest.fn().mockResolvedValue([
        {
          id: 'private-promotion-id',
          name: 'Tarde de frappés',
          description: '2x1 de 3:00 p. m. a 5:00 p. m.',
        },
      ]),
      getFaqs: jest.fn().mockResolvedValue([
        {
          id: 'private-faq-id',
          question: '¿Cuál es el horario?',
          answer: 'Atendemos todos los días.',
          category: 'HOURS',
        },
      ]),
    };
    const service = new KnowledgeContextService(catalog);

    const context = await service.getContext();

    expect(JSON.parse(context)).toEqual({
      products: [
        {
          name: 'Latte Nube',
          description: 'Espresso doble con leche vaporizada.',
          price: '14.00',
          currency: 'PEN',
          category: 'HOT_DRINK',
        },
      ],
      promotions: [
        {
          name: 'Tarde de frappés',
          description: '2x1 de 3:00 p. m. a 5:00 p. m.',
        },
      ],
      faqs: [
        {
          question: '¿Cuál es el horario?',
          answer: 'Atendemos todos los días.',
          category: 'HOURS',
        },
      ],
    });
    expect(context).not.toContain('private-product-id');
    expect(context).not.toContain('internalNote');
  });
});
