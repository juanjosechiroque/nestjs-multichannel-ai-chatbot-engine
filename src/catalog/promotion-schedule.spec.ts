import { getPromotionSchedule, isPromotionCurrent } from './promotion-schedule';

describe('promotion schedule', () => {
  const limaTimeZone = 'America/Lima';

  it('evaluates recurring days and hours in the business time zone', () => {
    const schedule = {
      days: ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY'],
      startTime: '15:00',
      endTime: '17:00',
    };

    expect(isPromotionCurrent(schedule, new Date('2026-08-10T21:00:00.000Z'), limaTimeZone)).toBe(
      true,
    );
    expect(isPromotionCurrent(schedule, new Date('2026-08-10T22:00:00.000Z'), limaTimeZone)).toBe(
      false,
    );
    expect(isPromotionCurrent(schedule, new Date('2026-08-14T21:00:00.000Z'), limaTimeZone)).toBe(
      false,
    );
  });

  it('uses the local weekday instead of the UTC weekday', () => {
    const fridayAllDay = { days: ['FRIDAY'] };
    const saturdayInUtcButFridayInLima = new Date('2026-08-15T00:30:00.000Z');

    expect(isPromotionCurrent(fridayAllDay, saturdayInUtcButFridayInLima, limaTimeZone)).toBe(true);
    expect(isPromotionCurrent(fridayAllDay, saturdayInUtcButFridayInLima, 'UTC')).toBe(false);
  });

  it('treats missing recurrence metadata as an all-day schedule', () => {
    expect(isPromotionCurrent(null, new Date('2026-08-15T00:30:00.000Z'), limaTimeZone)).toBe(true);
    expect(getPromotionSchedule(null)).toEqual({ days: [], startTime: null, endTime: null });
  });

  it('rejects malformed or unsupported schedules instead of overpromising validity', () => {
    const evaluatedAt = new Date('2026-08-10T21:00:00.000Z');

    expect(isPromotionCurrent({ days: ['FUNDAY'] }, evaluatedAt, limaTimeZone)).toBe(false);
    expect(isPromotionCurrent({ startTime: 'afternoon' }, evaluatedAt, limaTimeZone)).toBe(false);
    expect(
      isPromotionCurrent({ startTime: '17:00', endTime: '15:00' }, evaluatedAt, limaTimeZone),
    ).toBe(false);
  });
});
