import type { PrismaService } from '../database/prisma.service';
import { ConversationService } from './conversation.service';

interface CreateConversationArgs {
  data: {
    sessionId: string;
    channel: string;
  };
}

describe('ConversationService', () => {
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
});
