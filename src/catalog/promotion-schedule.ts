import type { PromotionSchedule } from './promotion.types';

const WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;

type Weekday = (typeof WEEKDAYS)[number];

interface ZonedMinute {
  weekday: Weekday;
  minuteOfDay: number;
}

export function getPromotionSchedule(metadata: unknown): PromotionSchedule {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { days: [], startTime: null, endTime: null };
  }

  const values = metadata as Record<string, unknown>;
  return {
    days: getWeekdays(values.days),
    startTime: getTime(values.startTime),
    endTime: getTime(values.endTime),
  };
}

export function isPromotionCurrent(
  metadata: unknown,
  evaluatedAt: Date,
  timeZone: string,
): boolean {
  if (!hasValidSchedule(metadata)) return false;

  const schedule = getPromotionSchedule(metadata);
  const zoned = getZonedMinute(evaluatedAt, timeZone);

  if (schedule.days.length > 0 && !schedule.days.includes(zoned.weekday)) {
    return false;
  }

  const startMinute = schedule.startTime ? parseMinute(schedule.startTime) : null;
  const endMinute = schedule.endTime ? parseMinute(schedule.endTime) : null;

  if (startMinute !== null && endMinute !== null && startMinute >= endMinute) {
    return false;
  }

  if (startMinute !== null && zoned.minuteOfDay < startMinute) {
    return false;
  }

  // Daily intervals use an exclusive end, matching date-range `endsAt` semantics.
  return endMinute === null || zoned.minuteOfDay < endMinute;
}

function hasValidSchedule(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return true;

  const values = metadata as Record<string, unknown>;
  if ('days' in values) {
    const days = values.days;
    if (
      !Array.isArray(days) ||
      days.length === 0 ||
      !days.every(
        (item) => typeof item === 'string' && WEEKDAYS.some((weekday) => weekday === item),
      )
    ) {
      return false;
    }
  }

  return (
    (!('startTime' in values) || getTime(values.startTime) !== null) &&
    (!('endTime' in values) || getTime(values.endTime) !== null)
  );
}

function getWeekdays(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.filter(
    (item): item is Weekday =>
      typeof item === 'string' && WEEKDAYS.some((weekday) => weekday === item),
  );
}

function getTime(value: unknown): string | null {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : null;
}

function parseMinute(value: string): number {
  const [hour = '0', minute = '0'] = value.split(':');
  return Number(hour) * 60 + Number(minute);
}

function getZonedMinute(evaluatedAt: Date, timeZone: string): ZonedMinute {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(evaluatedAt);
  const weekday = parts.find((part) => part.type === 'weekday')?.value.toUpperCase();
  const hour = Number(parts.find((part) => part.type === 'hour')?.value);
  const minute = Number(parts.find((part) => part.type === 'minute')?.value);

  if (
    !WEEKDAYS.some((value) => value === weekday) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    throw new RangeError(`Could not evaluate promotion time in ${timeZone}`);
  }

  return { weekday: weekday as Weekday, minuteOfDay: hour * 60 + minute };
}
