import { BadRequestException } from '@nestjs/common';
import { CURRENCIES } from '../itineraries/reference-data';
import { SummaryCategory } from './budgeting.constants';
import { NativeBudgetSummaryDto } from './dto/budget-summary.dto';
import { ConvertedBudgetSummaryDto } from './dto/converted-budget-summary.dto';
import { CachedFxRates } from './fx-rates.service';

function decimalFraction(value: number): [bigint, bigint] {
  const [decimal, exponent = '0'] = value.toString().split('e');
  const [whole, fraction = ''] = decimal.split('.');
  const scale = fraction.length - Number(exponent);
  const numerator = BigInt(whole + fraction);
  return scale < 0
    ? [numerator * 10n ** BigInt(-scale), 1n]
    : [numerator, 10n ** BigInt(scale)];
}

function safeAmount(value: bigint): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new BadRequestException(
      'Converted budget exceeds the safe integer range',
    );
  }
  return Number(value);
}

export function convertMinor(
  amount: number,
  from: string,
  to: string,
  rates: Record<string, number>,
): number {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    !CURRENCIES.includes(from as (typeof CURRENCIES)[number]) ||
    !CURRENCIES.includes(to as (typeof CURRENCIES)[number])
  ) {
    throw new BadRequestException('Unsupported budget amount or currency');
  }
  if (from === to) return amount;
  const sourceRate = rates[from];
  const targetRate = rates[to];
  if (
    !Number.isFinite(sourceRate) ||
    sourceRate <= 0 ||
    !Number.isFinite(targetRate) ||
    targetRate <= 0
  ) {
    throw new BadRequestException('A required currency rate is missing');
  }
  const [sourceNumerator, sourceDenominator] = decimalFraction(sourceRate);
  const [targetNumerator, targetDenominator] = decimalFraction(targetRate);
  // The supported JPY currency has zero minor-unit decimals, the other six have two.
  const numerator =
    BigInt(amount) *
    targetNumerator *
    sourceDenominator *
    (to === 'JPY' ? 1n : 100n);
  const denominator =
    sourceNumerator * targetDenominator * (from === 'JPY' ? 1n : 100n);
  // Round half up once per day/category/source-currency subtotal. Integer fractions
  // avoid binary floating-point rounding of large valid monetary amounts.
  return safeAmount((numerator * 2n + denominator) / (denominator * 2n));
}

export function convertedBudgetSummary(
  native: NativeBudgetSummaryDto,
  currency: string,
  fx: CachedFxRates,
): ConvertedBudgetSummaryDto {
  if (!CURRENCIES.includes(currency as (typeof CURRENCIES)[number])) {
    throw new BadRequestException(
      'Select a supported preferred currency in your profile',
    );
  }
  const byCategory: Record<SummaryCategory, number> = {
    food: 0,
    accommodation: 0,
    in_city_transport: 0,
    activities: 0,
    intercity_transport: 0,
  };
  const byDay = native.byDay.map((day) => {
    const categories: Record<SummaryCategory, number> = {
      food: 0,
      accommodation: 0,
      in_city_transport: 0,
      activities: 0,
      intercity_transport: 0,
    };
    for (const category of Object.keys(categories) as SummaryCategory[]) {
      const amounts = Object.entries(day.byCategory[category]);
      categories[category] = safeAmount(
        amounts.reduce(
          (sum, [from, amount]) =>
            sum + BigInt(convertMinor(amount, from, currency, fx.rates)),
          0n,
        ),
      );
      byCategory[category] = safeAmount(
        BigInt(byCategory[category]) + BigInt(categories[category]),
      );
    }
    const totalMinor = safeAmount(
      Object.values(categories).reduce(
        (sum, amount) => sum + BigInt(amount),
        0n,
      ),
    );
    return {
      dayId: day.dayId,
      dayNumber: day.dayNumber,
      date: day.date,
      totalMinor,
      byCategory: categories,
    };
  });
  return {
    currency,
    totalMinor: safeAmount(
      byDay.reduce((sum, day) => sum + BigInt(day.totalMinor), 0n),
    ),
    byCategory,
    byDay,
    rateDate: fx.rateDate,
    fetchedAt: fx.fetchedAt,
    fallback: fx.fallback,
    stale: fx.stale,
    source: 'FXRatesAPI',
  };
}
