import { BadRequestException } from '@nestjs/common';
import {
  addDays,
  assertNoOverlaps,
  assertStay,
  cancellationRefund,
  covers,
  daysBetween,
  isRoomOpen,
  overlaps,
  refundPercent,
  todayUtc,
} from './stay-rules';

describe('stay rules', () => {
  const now = new Date('2026-12-10T15:00:00Z');

  it('counts nights between dates, across months and leap days', () => {
    expect(daysBetween('2026-12-10', '2026-12-13')).toBe(3);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('treats ranges as half-open, so back-to-back stays do not overlap', () => {
    const stay = { from: '2026-12-10', to: '2026-12-12' };
    expect(overlaps(stay, { from: '2026-12-12', to: '2026-12-14' })).toBe(
      false,
    );
    expect(overlaps(stay, { from: '2026-12-08', to: '2026-12-10' })).toBe(
      false,
    );
    expect(overlaps(stay, { from: '2026-12-11', to: '2026-12-15' })).toBe(true);
    expect(overlaps(stay, { from: '2026-12-01', to: '2026-12-31' })).toBe(true);
  });

  it('accepts a stay only when every night is covered by availability', () => {
    const ranges = [
      { from: '2026-12-15', to: '2026-12-20' },
      { from: '2026-12-01', to: '2026-12-10' },
      { from: '2026-12-10', to: '2026-12-12' },
    ];
    expect(covers(ranges, { from: '2026-12-08', to: '2026-12-12' })).toBe(true);
    expect(covers(ranges, { from: '2026-12-11', to: '2026-12-16' })).toBe(
      false,
    );
    expect(covers([], { from: '2026-12-01', to: '2026-12-02' })).toBe(false);
  });

  it('closes a room for stays that touch a blocked range', () => {
    const room = {
      availability: [{ from: '2026-12-01', to: '2027-01-01' }],
      blocked: [{ from: '2026-12-24', to: '2026-12-26' }],
    };
    expect(isRoomOpen(room, { from: '2026-12-20', to: '2026-12-24' })).toBe(
      true,
    );
    expect(isRoomOpen(room, { from: '2026-12-23', to: '2026-12-25' })).toBe(
      false,
    );
  });

  it('rejects overlapping or empty availability ranges', () => {
    expect(() =>
      assertNoOverlaps([
        { from: '2026-12-01', to: '2026-12-05' },
        { from: '2026-12-04', to: '2026-12-08' },
      ]),
    ).toThrow(BadRequestException);
    expect(() =>
      assertNoOverlaps([{ from: '2026-12-05', to: '2026-12-05' }]),
    ).toThrow(BadRequestException);
    expect(() =>
      assertNoOverlaps([
        { from: '2026-12-05', to: '2026-12-08' },
        { from: '2026-12-01', to: '2026-12-05' },
      ]),
    ).not.toThrow();
  });

  it('validates stay dates against today in UTC', () => {
    expect(todayUtc(now)).toBe('2026-12-10');
    expect(assertStay({ from: '2026-12-10', to: '2026-12-12' }, now)).toBe(2);
    expect(() =>
      assertStay({ from: '2026-12-09', to: '2026-12-12' }, now),
    ).toThrow('Check-in cannot be in the past');
    expect(() =>
      assertStay({ from: '2026-12-12', to: '2026-12-12' }, now),
    ).toThrow('Check-out must be after check-in');
  });

  it('uses the tier with the highest threshold not above the days left, else 0%', () => {
    const tiers = [
      { daysBefore: 2, refundPercent: 25 },
      { daysBefore: 14, refundPercent: 100 },
      { daysBefore: 7, refundPercent: 50 },
    ];
    expect(refundPercent(tiers, 30)).toBe(100);
    expect(refundPercent(tiers, 14)).toBe(100);
    expect(refundPercent(tiers, 13)).toBe(50);
    expect(refundPercent(tiers, 3)).toBe(25);
    expect(refundPercent(tiers, 1)).toBe(0);
    expect(refundPercent([], 100)).toBe(0);
  });

  it('computes the refund on the full total', () => {
    const tiers = [{ daysBefore: 7, refundPercent: 50 }];
    expect(
      cancellationRefund(30_001, tiers, '2026-12-20', '2026-12-10'),
    ).toEqual({
      refundPercent: 50,
      refundMinor: 15_001,
    });
    expect(
      cancellationRefund(30_000, tiers, '2026-12-12', '2026-12-10'),
    ).toEqual({
      refundPercent: 0,
      refundMinor: 0,
    });
  });
});
