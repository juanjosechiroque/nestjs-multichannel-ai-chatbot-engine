import { hours, minutes, type ThrottlerModuleOptions } from '@nestjs/throttler';

export const CONVERSATION_RATE_LIMIT_NAME = 'conversation';
export const CHAT_RATE_LIMIT_NAME = 'chat';

interface RateLimitConfig {
  get(propertyPath: string, defaultValue: number): number;
}

export function createWebRateLimitOptions(config: RateLimitConfig): ThrottlerModuleOptions {
  return {
    throttlers: [
      {
        name: CONVERSATION_RATE_LIMIT_NAME,
        ttl: hours(1),
        limit: config.get('RATE_LIMIT_CONVERSATIONS_PER_HOUR', 5),
        getTracker: getIpTracker,
      },
      {
        name: CHAT_RATE_LIMIT_NAME,
        ttl: minutes(1),
        limit: config.get('RATE_LIMIT_MESSAGES_PER_MINUTE', 10),
        getTracker: getSessionTracker,
      },
    ],
    errorMessage: 'Has realizado demasiadas solicitudes. Inténtalo nuevamente más tarde.',
  };
}

export function getIpTracker(request: Record<string, unknown>): string {
  const ip = request.ip;
  if (typeof ip === 'string' && ip.length > 0) {
    return `ip:${ip}`;
  }

  const socket = request.socket;
  if (isRecord(socket) && typeof socket.remoteAddress === 'string') {
    return `ip:${socket.remoteAddress}`;
  }

  return 'ip:unknown';
}

export function getSessionTracker(request: Record<string, unknown>): string {
  const body = request.body;
  if (isRecord(body) && typeof body.sessionId === 'string' && body.sessionId.length > 0) {
    return `session:${body.sessionId}`;
  }

  return getIpTracker(request);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
