import { BadRequestException } from '@nestjs/common';

/**
 * Dates are YYYY-MM-DD strings in UTC. A range covers the nights from `from`
 * up to, but not including, `to` - exactly like a stay from check-in to check-out.
 */
export interface NightRange {
  from: string;
  to: string;
}

export interface RefundTier {
  daysBefore: number;
  refundPercent: number;
}

const DAY_MS = 86_400_000;

export function todayUtc(now = new Date()): string {
  return now.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS,
  );
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function overlaps(a: NightRange, b: NightRange): boolean {
  return a.from < b.to && b.from < a.to;
}

/** True when the (non-overlapping) ranges together include every night of the stay. */
export function covers(ranges: NightRange[], stay: NightRange): boolean {
  let coveredUntil = stay.from;
  for (const range of [...ranges].sort((a, b) =>
    a.from.localeCompare(b.from),
  )) {
    if (range.from > coveredUntil) break;
    if (range.to > coveredUntil) coveredUntil = range.to;
  }
  return coveredUntil >= stay.to;
}

export function assertRange(range: NightRange): void {
  if (range.to <= range.from) {
    throw new BadRequestException('Each date range must end after it starts');
  }
}

export function assertNoOverlaps(ranges: NightRange[]): void {
  const sorted = [...ranges].sort((a, b) => a.from.localeCompare(b.from));
  sorted.forEach(assertRange);
  for (let i = 1; i < sorted.length; i++) {
    if (overlaps(sorted[i - 1], sorted[i])) {
      throw new BadRequestException('Availability ranges must not overlap');
    }
  }
}

/** HTL-11/HTL-18: check-out after check-in and check-in not in the past. Returns the nights. */
export function assertStay(stay: NightRange, now = new Date()): number {
  if (stay.to <= stay.from)
    throw new BadRequestException('Check-out must be after check-in');
  if (stay.from < todayUtc(now))
    throw new BadRequestException('Check-in cannot be in the past');
  return daysBetween(stay.from, stay.to);
}

/** A room accepts a stay when its availability covers every night and nothing is blocked. */
export function isRoomOpen(
  room: { availability: NightRange[]; blocked: NightRange[] },
  stay: NightRange,
): boolean {
  return (
    covers(room.availability, stay) &&
    !room.blocked.some((range) => overlaps(range, stay))
  );
}

/** FLT-09/HTL-10: the tier with the highest threshold not above the days left; none means 0%. */
export function refundPercent(
  tiers: RefundTier[],
  daysBeforeCheckIn: number,
): number {
  const applicable = tiers.filter(
    (tier) => tier.daysBefore <= daysBeforeCheckIn,
  );
  if (applicable.length === 0) return 0;
  return applicable.reduce((best, tier) =>
    tier.daysBefore > best.daysBefore ? tier : best,
  ).refundPercent;
}

/** HTL-21: refund for cancelling the whole reservation today, on its full total. */
export function cancellationRefund(
  totalMinor: number,
  tiers: RefundTier[],
  checkIn: string,
  today = todayUtc(),
): { refundPercent: number; refundMinor: number } {
  const percent = refundPercent(tiers, daysBetween(today, checkIn));
  return {
    refundPercent: percent,
    refundMinor: Math.round((totalMinor * percent) / 100),
  };
}
