import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { DailyFxRates, FxRatesClient, validateRates } from './fx-rates.client';
import { FxRateCache } from './schemas/fx-rate-cache.schema';

export interface CachedFxRates extends DailyFxRates {
  fetchedAt: string;
  fallback: boolean;
  stale: boolean;
}

@Injectable()
export class FxRatesService {
  constructor(
    @InjectModel(FxRateCache.name) private readonly cache: Model<FxRateCache>,
    private readonly client: FxRatesClient,
  ) {}

  async current(): Promise<CachedFxRates> {
    const day = new Date().toISOString().slice(0, 10);
    const requestedAt = new Date();
    const attemptId = randomUUID();
    let shouldFetch = false;
    try {
      await this.cache.create({
        _id: day,
        status: 'fetching',
        requestedAt,
        attemptId,
      });
      shouldFetch = true;
    } catch (error: unknown) {
      if (!(
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      ))
        throw error;
      // A failed request or crashed process may be retried after one minute.
      // The conditional claim permits only one retry owner across processes.
      const retry = await this.cache
        .updateOne(
          {
            _id: day,
            status: { $in: ['failed', 'fetching'] },
            requestedAt: { $lte: new Date(requestedAt.getTime() - 60_000) },
          },
          { $set: { status: 'fetching', requestedAt, attemptId } },
        )
        .exec();
      shouldFetch = retry.modifiedCount === 1;
    }

    if (shouldFetch) {
      try {
        const snapshot = await this.client.latest();
        await this.cache
          .updateOne(
            { _id: day, attemptId },
            { $set: { ...snapshot, fetchedAt: new Date(), status: 'ready' } },
            { runValidators: true },
          )
          .exec();
      } catch {
        await this.cache
          .updateOne({ _id: day, attemptId }, { $set: { status: 'failed' } })
          .exec();
      }
    }

    // A different process may own today's request. Its network timeout is five
    // seconds. Readers wait briefly for the same result, never issue another fetch.
    let today = await this.cache.findById(day).exec();
    for (
      let attempt = 0;
      today?.status === 'fetching' &&
      today.requestedAt?.getTime() > Date.now() - 6000 &&
      attempt < 120;
      attempt++
    ) {
      await delay(50);
      today = await this.cache.findById(day).exec();
    }
    const snapshot =
      today?.status === 'ready'
        ? today
        : await this.cache
            .findOne({ status: 'ready', _id: { $lte: day } })
            .sort({ _id: -1 })
            .exec();
    if (!snapshot?.fetchedAt || !snapshot.rateDate || !snapshot.rates) {
      throw new ServiceUnavailableException(
        'Exchange rates are unavailable and no cached rates exist',
      );
    }
    try {
      const parsed = validateRates({
        success: true,
        base: 'USD',
        date: snapshot.rateDate,
        rates: Object.fromEntries(snapshot.rates),
      });
      return {
        ...parsed,
        fetchedAt: snapshot.fetchedAt.toISOString(),
        fallback: snapshot._id !== day,
        stale: parsed.rateDate < day,
      };
    } catch {
      throw new ServiceUnavailableException(
        'Cached exchange rates are invalid',
      );
    }
  }
}
