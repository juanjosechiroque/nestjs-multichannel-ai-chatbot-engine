import { Logger } from '@nestjs/common';
import { MessageRole } from '../generated/prisma/enums';
import { DatabaseUnavailableException } from '../common/application-error';
import type { PrismaService } from '../database/prisma.service';
import { MemoryService } from './memory.service';

const REQUEST_CONTEXT = {
  requestId: 'request-1',
  conversationId: 'conversation-id',
  channel: 'web',
};

describe('MemoryService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns the most recent messages in chronological order', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const findMany = jest.fn().mockResolvedValue([
      { role: MessageRole.ASSISTANT, content: 'El Espresso Nube cuesta S/ 8.' },
      { role: MessageRole.USER, content: '¿Cuál es la más barata?' },
    ]);
    const prisma = {
      conversationMessage: { findMany },
    } as unknown as PrismaService;
    const service = new MemoryService(prisma);

    const messages = await service.getRecentMessages('conversation-id', REQUEST_CONTEXT);

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
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'memory.history.loaded',
        ...REQUEST_CONTEXT,
        messages: 2,
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('¿Cuál es la más barata?');
  });

  it('returns an empty history for a new session', async () => {
    const prisma = {
      conversationMessage: {
        findMany: jest.fn().mockResolvedValue([]),
      },
    } as unknown as PrismaService;
    const service = new MemoryService(prisma);

    const messages = await service.getRecentMessages('new-conversation', {
      ...REQUEST_CONTEXT,
      conversationId: 'new-conversation',
    });

    expect(messages).toEqual([]);
  });

  it('stores the user and assistant messages in an existing conversation', async () => {
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const update = jest.fn().mockResolvedValue({ id: 'conversation-id' });
    const prisma = {
      conversation: { update },
    } as unknown as PrismaService;
    const service = new MemoryService(prisma);

    await service.saveExchange(
      {
        conversationId: 'conversation-id',
        userMessage: 'Hola',
        assistantMessage: '¡Hola! ¿Cómo puedo ayudarte?',
      },
      REQUEST_CONTEXT,
    );

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
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'memory.exchange.saved',
        ...REQUEST_CONTEXT,
      }),
    );
    expect(JSON.stringify(log.mock.calls)).not.toContain('¡Hola! ¿Cómo puedo ayudarte?');
  });

  it.each([
    {
      name: 'reading history',
      run: (service: MemoryService) =>
        service.getRecentMessages('conversation-id', REQUEST_CONTEXT),
      prisma: {
        conversationMessage: {
          findMany: jest.fn().mockRejectedValue(new Error('read failed')),
        },
      },
    },
    {
      name: 'writing an exchange',
      run: (service: MemoryService) =>
        service.saveExchange(
          {
            conversationId: 'conversation-id',
            userMessage: 'Hola',
            assistantMessage: 'Hola',
          },
          REQUEST_CONTEXT,
        ),
      prisma: {
        conversation: {
          update: jest.fn().mockRejectedValue(new Error('write failed')),
        },
      },
    },
  ])('returns a controlled database error when $name fails', async ({ run, prisma }) => {
    const service = new MemoryService(prisma as unknown as PrismaService);

    await expect(run(service)).rejects.toEqual(new DatabaseUnavailableException());
  });
});
