import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CURRENCIES } from '../itineraries/reference-data';

export interface DailyFxRates {
  rateDate: string;
  rates: Record<string, number>;
}

/** Positive USD-based rates for every supported itinerary currency. */
export function validateRates(value: unknown): DailyFxRates {
  if (!value || typeof value !== 'object') throw new Error('Invalid rates');
  const input = value as Record<string, unknown>;
  if (
    input.success !== true ||
    input.base !== 'USD' ||
    typeof input.date !== 'string'
  ) {
    throw new Error('Invalid rates');
  }
  const date = new Date(input.date);
  const rateDate = input.date.slice(0, 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(rateDate) ||
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== rateDate ||
    rateDate > new Date().toISOString().slice(0, 10)
  ) {
    throw new Error('Invalid rate date');
  }
  if (
    !input.rates ||
    typeof input.rates !== 'object' ||
    Array.isArray(input.rates)
  )
    throw new Error('Invalid rates');
  const source = input.rates as Record<string, unknown>;
  const rates: Record<string, number> = {};
  for (const currency of CURRENCIES) {
    const rate = source[currency];
    if (typeof rate !== 'number' || !Number.isFinite(rate) || rate <= 0)
      throw new Error('Incomplete rates');
    rates[currency] = rate;
  }
  if (rates.USD !== 1) throw new Error('Invalid base rate');
  return { rateDate, rates };
}

@Injectable()
export class FxRatesClient {
  constructor(private readonly config: ConfigService) {}

  async latest(): Promise<DailyFxRates> {
    const url = new URL('https://api.fxratesapi.com/latest');
    url.searchParams.set('base', 'USD');
    url.searchParams.set('currencies', CURRENCIES.join(','));
    url.searchParams.set('resolution', '1d');
    const key = this.config.get<string>('FXRATES_API_KEY');
    if (key) url.searchParams.set('api_key', key);
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(5000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('FX service rejected request');
      return validateRates(await response.json());
    } catch {
      // Do not propagate a provider body, URL or underlying error containing a key.
      throw new ServiceUnavailableException('Exchange rates are unavailable');
    }
  }
}
