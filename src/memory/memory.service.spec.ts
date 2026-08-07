import { MessageRole } from '../generated/prisma/enums';
import type { PrismaService } from '../database/prisma.service';
import { MemoryService } from './memory.service';

describe('MemoryService', () => {
  it('returns the most recent messages in chronological order', async () => {
    const findMany = jest.fn().mockResolvedValue([
      { role: MessageRole.ASSISTANT, content: 'El Espresso Nube cuesta S/ 8.' },
      { role: MessageRole.USER, content: '¿Cuál es la más barata?' },
    ]);
    const prisma = {
      conversationMessage: { findMany },
    } as unknown as PrismaService;
    const service = new MemoryService(prisma);

    const messages = await service.getRecentMessages('conversation-id');

    expect(messages).toEqual([
      { role: 'user', content: '¿Cuál es la más barata?' },
      { role: 'assistant', content: 'El Espresso Nube cuesta S/ 8.' },
    ]);
    expect(findMany).toHaveBeenCalledWith({
      where: { conversationId: 'conversation-id' },
      orderBy: { id: 'desc' },
      take: 10,
      select: {
        role: true,
        content: true,
      },
    });
  });

  it('returns an empty history for a new session', async () => {
    const prisma = {
      conversationMessage: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;
    const service = new MemoryService(prisma);

    const messages = await service.getRecentMessages('new-conversation');

    expect(messages).toEqual([]);
  });

  it('stores the user and assistant messages in an existing conversation', async () => {
    const update = jest.fn().mockResolvedValue({ id: 'conversation-id' });
    const prisma = {
      conversation: { update },
    } as unknown as PrismaService;
    const service = new MemoryService(prisma);

    await service.saveExchange({
      conversationId: 'conversation-id',
      userMessage: 'Hola',
      assistantMessage: '¡Hola! ¿Cómo puedo ayudarte?',
    });

    const messages = {
      create: [
        { role: MessageRole.USER, content: 'Hola' },
        { role: MessageRole.ASSISTANT, content: '¡Hola! ¿Cómo puedo ayudarte?' },
      ],
    };
    expect(update).toHaveBeenCalledWith({
      where: { id: 'conversation-id' },
      data: { messages },
    });
  });
});
