export const WHATSAPP_ENABLED_ENV_VAR = 'WHATSAPP_ENABLED';

/** Strict opt-in: an absent flag is disabled and ambiguous values are rejected. */
export function parseWhatsAppEnabled(value: unknown): boolean {
  if (value === undefined || value === null) {
    return false;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (value === 'true') {
    return true;
  }
  if (value === 'false') {
    return false;
  }

  throw new Error(
    `Invalid ${WHATSAPP_ENABLED_ENV_VAR}: expected "true" or "false", received ${JSON.stringify(value)}`,
  );
}

export function isWhatsAppEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseWhatsAppEnabled(env[WHATSAPP_ENABLED_ENV_VAR]);
}
