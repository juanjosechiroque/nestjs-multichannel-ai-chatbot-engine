import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { BusinessProfile } from './contract';

const DEFAULT_PROFILE_PATH = 'business/profile.json';

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isValidTimeZone(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** Validate an already-parsed value against the profile shape, or throw. */
export function parseBusinessProfile(raw: unknown, source = DEFAULT_PROFILE_PATH): BusinessProfile {
  const fail = (reason: string): never => {
    throw new Error(`Invalid ${source}: ${reason}`);
  };

  if (typeof raw !== 'object' || raw === null) fail('expected a JSON object');
  const profile = raw as Record<string, unknown>;

  if (!isNonEmptyString(profile.name)) fail('"name" must be a non-empty string');
  if (!isValidTimeZone(profile.timeZone)) {
    fail(`"timeZone" must be a valid IANA time zone (got ${JSON.stringify(profile.timeZone)})`);
  }
  if (profile.menuTitle !== undefined && !isNonEmptyString(profile.menuTitle)) {
    fail('"menuTitle" must be a non-empty string when present');
  }

  return {
    name: profile.name as string,
    timeZone: profile.timeZone as string,
    ...(profile.menuTitle === undefined ? {} : { menuTitle: profile.menuTitle as string }),
  };
}

/** Read and validate the business identity from disk. */
export function loadBusinessProfile(profilePath = DEFAULT_PROFILE_PATH): BusinessProfile {
  const absolutePath = resolve(process.cwd(), profilePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(absolutePath, 'utf8'));
  } catch (error: unknown) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Unable to read ${profilePath}: ${reason}`);
  }
  return parseBusinessProfile(parsed, profilePath);
}

/** The single business this deployment serves, loaded and validated from disk. */
export const businessProfile: BusinessProfile = loadBusinessProfile();
