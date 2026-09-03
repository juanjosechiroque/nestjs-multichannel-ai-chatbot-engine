/** The environment variable that opts a deployment into the WhatsApp channel. */
export const WHATSAPP_ENABLED_ENV_VAR = 'WHATSAPP_ENABLED';

/**
 * Interprets the optional `WHATSAPP_ENABLED` flag.
 *
 * WhatsApp is an optional adapter: a Web-only deployment must boot with no Meta
 * credentials at all. Activation is therefore explicit and strict — only the
 * exact strings `"true"` and `"false"` (or their boolean equivalents) are
 * accepted, so a stray `"yes"`, `"1"`, or empty value fails loudly instead of
 * being coerced. `Boolean("false")` is `true`, so the string is matched by hand.
 *
 * An absent flag defaults to disabled, keeping the Web-only quick start free of
 * Meta configuration.
 *
 * This is the single interpreter of the flag, shared by `validateEnvironment`
 * and the conditional module composition in `AppModule`.
 */
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

/**
 * Reads and interprets `WHATSAPP_ENABLED` from an environment bag. Used as the
 * `ConditionalModule.registerWhen` predicate in `AppModule` so the composition
 * boundary and `validateEnvironment` share one interpreter.
 */
export function isWhatsAppEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseWhatsAppEnabled(env[WHATSAPP_ENABLED_ENV_VAR]);
}
