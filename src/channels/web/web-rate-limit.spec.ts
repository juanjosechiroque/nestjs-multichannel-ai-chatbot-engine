import { ConfigService } from '@nestjs/config';
import {
  CHAT_RATE_LIMIT_NAME,
  CONVERSATION_RATE_LIMIT_NAME,
  createWebRateLimitOptions,
  getIpTracker,
  getSessionTracker,
} from './web-rate-limit';

describe('web rate limiting', () => {
  it('configures five conversations per hour and ten messages per minute by default', () => {
    const options = createWebRateLimitOptions(new ConfigService());

    expect(Array.isArray(options)).toBe(false);
    if (Array.isArray(options)) throw new Error('Expected common throttler options');
    expect(options.throttlers).toEqual([
      expect.objectContaining({
        name: CONVERSATION_RATE_LIMIT_NAME,
        limit: 5,
        ttl: 3_600_000,
      }),
      expect.objectContaining({
        name: CHAT_RATE_LIMIT_NAME,
        limit: 10,
        ttl: 60_000,
      }),
    ]);
  });

  it('tracks conversation creation by IP and falls back to the socket address', () => {
    expect(getIpTracker({ ip: '203.0.113.10' })).toBe('ip:203.0.113.10');
    expect(getIpTracker({ socket: { remoteAddress: '127.0.0.1' } })).toBe('ip:127.0.0.1');
    expect(getIpTracker({})).toBe('ip:unknown');
  });

  it('tracks messages by session and falls back to the request IP', () => {
    expect(getSessionTracker({ body: { sessionId: 'session-1' }, ip: '203.0.113.10' })).toBe(
      'session:session-1',
    );
    expect(getSessionTracker({ body: {}, ip: '203.0.113.10' })).toBe('ip:203.0.113.10');
  });

  it('uses validated environment overrides', () => {
    const options = createWebRateLimitOptions(
      new ConfigService({
        RATE_LIMIT_CONVERSATIONS_PER_HOUR: 8,
        RATE_LIMIT_MESSAGES_PER_MINUTE: 12,
      }),
    );

    if (Array.isArray(options)) throw new Error('Expected common throttler options');
    expect(options.throttlers.map(({ limit }) => limit)).toEqual([8, 12]);
  });
});
