import { BadRequestException } from '@nestjs/common';
import type {
  ActivityCost,
  Itinerary,
} from '../itineraries/schemas/itinerary.schema';
import { itineraryDate } from '../itineraries/calendar';
import { SummaryCategory } from './budgeting.constants';
import {
  CurrencyTotals,
  NativeBudgetBucketDto,
  NativeBudgetSummaryDto,
} from './dto/budget-summary.dto';

function emptyBucket(): NativeBudgetBucketDto {
  return {
    totalByCurrency: {},
    byCategory: {
      food: {},
      accommodation: {},
      in_city_transport: {},
      activities: {},
      intercity_transport: {},
    },
  };
}

export function addCurrencyTotal(
  totals: CurrencyTotals,
  currency: string,
  amountMinor: number,
): void {
  const next = (totals[currency] ?? 0) + amountMinor;
  if (
    amountMinor < 0 ||
    !Number.isSafeInteger(amountMinor) ||
    !Number.isSafeInteger(next)
  ) {
    throw new BadRequestException(
      'Budget amounts and totals must be non-negative safe integers',
    );
  }
  totals[currency] = next;
}

export function nativeBudgetSummary(
  itinerary: Itinerary,
): NativeBudgetSummaryDto {
  const overall = emptyBucket();
  const byDay = itinerary.days.map((day, index) => {
    const bucket = emptyBucket();
    const record = (category: SummaryCategory, cost: ActivityCost) => {
      addCurrencyTotal(bucket.totalByCurrency, cost.currency, cost.amountMinor);
      addCurrencyTotal(
        bucket.byCategory[category],
        cost.currency,
        cost.amountMinor,
      );
      addCurrencyTotal(
        overall.totalByCurrency,
        cost.currency,
        cost.amountMinor,
      );
      addCurrencyTotal(
        overall.byCategory[category],
        cost.currency,
        cost.amountMinor,
      );
    };
    for (const entry of day.budgets ?? []) record(entry.category, entry);
    for (const activity of day.activities)
      if (activity.cost) record('activities', activity.cost);
    for (const entry of day.transportCosts ?? [])
      record('intercity_transport', entry);
    return {
      dayId: day._id.toString(),
      dayNumber: index + 1,
      date: itineraryDate(itinerary.startDate, index),
      ...bucket,
    };
  });
  return { ...overall, byDay };
}
