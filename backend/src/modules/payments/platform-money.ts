import { BadRequestException } from '@nestjs/common';

// Hassib delegated the PAY-04 currency choice on November 17, 2026.
export const PLATFORM_CURRENCY = 'USD' as const;

export function assertStripePayableMoney(
  amountMinor: number,
  currency: string,
): void {
  assertPlatformMoney(amountMinor, currency);
  if (amountMinor < 50 || amountMinor > 99_999_999) {
    throw new BadRequestException(
      'Stripe USD payment amounts must be between 50 and 99999999 cents',
    );
  }
}

export function assertPlatformMoney(
  amountMinor: number,
  currency: string,
): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
    throw new BadRequestException(
      'Payment amounts must be positive integer minor units',
    );
  }
  if (
    typeof currency !== 'string' ||
    currency.trim().toUpperCase() !== PLATFORM_CURRENCY
  ) {
    throw new BadRequestException(
      'Flight/hotel payments and refunds must use USD',
    );
  }
}
