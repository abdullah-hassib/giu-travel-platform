import { BadRequestException } from '@nestjs/common';
import { airportLocalTimeToUtc } from './airport-timezone.util';

describe('airportLocalTimeToUtc', () => {
  it('converts Cairo local time to UTC', () => {
    const result = airportLocalTimeToUtc(
      '2026-12-01T10:30',
      'Africa/Cairo',
    );

    expect(result.toISOString()).toBe('2026-12-01T08:30:00.000Z');
  });

  it('converts London local time to UTC', () => {
    const result = airportLocalTimeToUtc(
      '2026-12-01T10:30',
      'Europe/London',
    );

    expect(result.toISOString()).toBe('2026-12-01T10:30:00.000Z');
  });

  it('rejects invalid calendar dates', () => {
    expect(() =>
      airportLocalTimeToUtc('2026-02-30T10:30', 'Africa/Cairo'),
    ).toThrow(BadRequestException);
  });

  it('rejects invalid timezone identifiers', () => {
    expect(() =>
      airportLocalTimeToUtc('2026-12-01T10:30', 'Invalid/Timezone'),
    ).toThrow(BadRequestException);
  });

  it('rejects nonexistent daylight-saving local times', () => {
    expect(() =>
      airportLocalTimeToUtc('2026-03-29T01:30', 'Europe/London'),
    ).toThrow(BadRequestException);
  });

  it('rejects ambiguous daylight-saving local times', () => {
    expect(() =>
      airportLocalTimeToUtc('2026-10-25T01:30', 'Europe/London'),
    ).toThrow(BadRequestException);
  });

  it('rejects incorrectly formatted local date-times', () => {
    expect(() =>
      airportLocalTimeToUtc('01-12-2026 10:30', 'Africa/Cairo'),
    ).toThrow(BadRequestException);
  });
});
