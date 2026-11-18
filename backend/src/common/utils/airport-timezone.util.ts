import { BadRequestException } from '@nestjs/common';
import { DateTime, IANAZone } from 'luxon';

/**
 * Converts an airport-local date/time into a UTC JavaScript Date.
 *
 * Input format: YYYY-MM-DDTHH:mm
 * Timezone: IANA timezone, e.g. Africa/Cairo
 *
 * Ambiguous and nonexistent local times are rejected to prevent
 * flights from being scheduled at an unintended instant.
 */
export function airportLocalTimeToUtc(
  localDateTime: string,
  timeZone: string,
): Date {
  if (!IANAZone.isValidZone(timeZone)) {
    throw new BadRequestException('Invalid airport timezone');
  }

  if (
    typeof localDateTime !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(localDateTime)
  ) {
    throw new BadRequestException(
      'Date and time must use YYYY-MM-DDTHH:mm format',
    );
  }

  const parsed = DateTime.fromISO(localDateTime, {
    zone: timeZone,
    setZone: true,
  });

  if (!parsed.isValid) {
    throw new BadRequestException('Invalid local date or time');
  }

  if (parsed.toFormat("yyyy-MM-dd'T'HH:mm") !== localDateTime) {
    throw new BadRequestException(
      'The specified local time does not exist in this timezone',
    );
  }

  const possibleInstants = parsed.getPossibleOffsets();

  if (possibleInstants.length !== 1) {
    throw new BadRequestException(
      'The specified local time is ambiguous in this timezone',
    );
  }

  return parsed.toUTC().toJSDate();
}
