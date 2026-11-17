import {
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ClientSession } from 'mongoose';

export const BOOKING_KINDS = ['flight', 'hotel'] as const;
export type BookingKind = (typeof BOOKING_KINDS)[number];
export const BOOKING_PAYMENT_ADAPTERS = Symbol('BOOKING_PAYMENT_ADAPTERS');
export const BOOKING_STATES = [
  'Pending Payment',
  'Confirmed',
  'Completed',
  'Cancelled',
  'Expired',
] as const;
export type BookingState = (typeof BOOKING_STATES)[number];

export interface CancellationTier {
  daysBefore: number;
  refundPercent: number;
}

export interface SegmentBaggagePolicy {
  segmentId: string;
  cabin: string;
  freeBagCount: number;
  maxWeightKg: number;
  extraBagPriceMinor: number;
  maxExtraBags: number;
}

export type BookingPolicies =
  | {
      type: 'flight';
      cancellation: CancellationTier[];
      baggage: SegmentBaggagePolicy[];
    }
  | {
      type: 'hotel';
      cancellation: CancellationTier[];
      checkInTime: string;
      checkOutTime: string;
    };

export interface BookingPaymentSnapshot {
  id: string;
  kind: BookingKind;
  userId: string;
  providerId: string;
  state: BookingState;
  revision: string;
  amountMinor: number;
  currency: string;
  holdExpiresAt: Date;
  policies: BookingPolicies;
}

/** Approved payment-side boundary. Concrete adapters are owned by Adham/MK. */
export interface BookingPaymentAdapter {
  readonly kind: BookingKind;
  /** Return only the owner's booking. Throw 404 for missing/foreign resources. */
  getOwned(userId: string, bookingId: string): Promise<BookingPaymentSnapshot>;
  /**
   * Use the supplied connection/session. Perform a conditional booking write
   * before returning its snapshot, so concurrent quote/policy/state edits cause
   * transaction conflicts. A separate payment fence may avoid changing the
   * business revision merely because policies were reviewed or accepted.
   */
  getOwnedForUpdate(
    userId: string,
    bookingId: string,
    session: ClientSession,
  ): Promise<BookingPaymentSnapshot>;
}

@Injectable()
export class BookingPaymentAdapters {
  constructor(
    @Inject(BOOKING_PAYMENT_ADAPTERS)
    private readonly adapters: BookingPaymentAdapter[],
  ) {
    if (
      new Set(adapters.map((adapter) => adapter.kind)).size !== adapters.length
    ) {
      throw new Error(
        'Only one payment adapter per booking kind may be registered',
      );
    }
  }

  forKind(kind: BookingKind): BookingPaymentAdapter {
    if (!BOOKING_KINDS.includes(kind))
      throw new NotFoundException('Booking type not found');
    const adapter = this.adapters.find((entry) => entry.kind === kind);
    if (!adapter)
      throw new ServiceUnavailableException(
        'Booking payment integration is not configured',
      );
    return adapter;
  }
}
