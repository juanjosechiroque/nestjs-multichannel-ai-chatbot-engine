import type { ChatChannel } from '../../chat/chat.types';
import type { RequestContext } from '../../common/request-context';
import type { ConversationService } from '../../conversation/conversation.service';
import type { ConversationReference } from '../../conversation/conversation.types';
import { WebConversationController } from './web-conversation.controller';

describe('WebConversationController', () => {
  it('creates a backend-managed session for the web channel', async () => {
    const create = jest
      .fn<Promise<ConversationReference>, [ChatChannel, RequestContext?]>()
      .mockResolvedValue({
        id: 'internal-conversation-id',
        sessionId: '59ad97ee-f9c0-44d7-8fb8-881b87d21e19',
      });
    const controller = new WebConversationController({
      create,
    } as unknown as ConversationService);

    await expect(controller.create()).resolves.toEqual({
      sessionId: '59ad97ee-f9c0-44d7-8fb8-881b87d21e19',
    });
    const [channel, context] = create.mock.calls[0] ?? [];
    expect(channel).toBe('web');
    expect(context).toEqual({
      requestId: context?.requestId,
      channel: 'web',
    });
    expect(context?.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });
});
