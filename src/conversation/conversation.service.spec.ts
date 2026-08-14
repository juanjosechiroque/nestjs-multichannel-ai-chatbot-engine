import { Logger } from '@nestjs/common';
import type { PrismaService } from '../database/prisma.service';
import { DatabaseUnavailableException } from '../common/application-error';
import { ConversationService } from './conversation.service';

interface CreateConversationArgs {
  data: {
    sessionId: string;
    channel: string;
  };
}

describe('ConversationService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('creates a web conversation with a backend-generated UUID', async () => {
    let receivedArgs: CreateConversationArgs | undefined;
    const create = jest.fn((args: CreateConversationArgs) => {
      receivedArgs = args;
      return Promise.resolve({
        id: 'internal-conversation-id',
        sessionId: args.data.sessionId,
      });
    });
    const prisma = {
      conversation: { create },
    } as unknown as PrismaService;
    const service = new ConversationService(prisma);

    const conversation = await service.create('web');

    expect(conversation.id).toBe('internal-conversation-id');
    expect(conversation.sessionId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(receivedArgs?.data.channel).toBe('web');
    expect(receivedArgs?.data.sessionId).toBe(conversation.sessionId);
  });

  it('resolves a session only within its channel', async () => {
    const findUnique = jest.fn().mockResolvedValue({
      id: 'internal-conversation-id',
      sessionId: 'public-session-id',
    });
    const prisma = {
      conversation: { findUnique },
    } as unknown as PrismaService;
    const service = new ConversationService(prisma);

    const conversation = await service.findBySession({
      sessionId: 'public-session-id',
      channel: 'web',
    });

    expect(conversation?.id).toBe('internal-conversation-id');
    expect(findUnique).toHaveBeenCalledWith({
      where: {
        channel_sessionId: {
          channel: 'web',
          sessionId: 'public-session-id',
        },
      },
      select: {
        id: true,
        sessionId: true,
      },
    });
  });

  it('returns a controlled database error when creating a conversation fails', async () => {
    const service = new ConversationService({
      conversation: {
        create: jest.fn().mockRejectedValue(new Error('connection failed')),
      },
    } as unknown as PrismaService);

    await expect(service.create('web')).rejects.toEqual(new DatabaseUnavailableException());
  });

  it('keeps the request identifier when the initial session lookup fails', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const service = new ConversationService({
      conversation: {
        findUnique: jest.fn().mockRejectedValue(new Error('connection failed')),
      },
    } as unknown as PrismaService);

    await expect(
      service.findBySession(
        { sessionId: 'public-session-id', channel: 'web' },
        { requestId: 'request-lookup', channel: 'web' },
      ),
    ).rejects.toEqual(new DatabaseUnavailableException());
    expect(error).toHaveBeenCalledWith({
      event: 'database.operation.failed',
      requestId: 'request-lookup',
      channel: 'web',
      operation: 'conversation.find_by_session',
      failureCode: 'DATABASE_UNAVAILABLE',
      message: 'connection failed',
    });
  });
});
