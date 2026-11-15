import { BadRequestException } from '@nestjs/common';

export function itineraryDate(startDate: string, offset: number): string {
  const date = new Date(`${startDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + offset);
  if (!Number.isFinite(date.getTime()) || date.getUTCFullYear() > 9999) {
    throw new BadRequestException(
      'Day dates exceed the supported calendar range',
    );
  }
  return date.toISOString().split('T')[0];
}
