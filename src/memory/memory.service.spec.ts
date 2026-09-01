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

  it('returns a controlled database error when reading history fails', async () => {
    const prisma = {
      conversationMessage: {
        findMany: jest.fn().mockRejectedValue(new Error('read failed')),
      },
    };
    const service = new MemoryService(prisma as unknown as PrismaService);

    await expect(service.getRecentMessages('conversation-id', REQUEST_CONTEXT)).rejects.toEqual(
      new DatabaseUnavailableException(),
    );
  });
});
