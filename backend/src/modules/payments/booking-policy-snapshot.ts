import { BadGatewayException } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { Types } from 'mongoose';
import { assertPlatformMoney, PLATFORM_CURRENCY } from './platform-money';
import {
  BookingKind,
  BookingPaymentSnapshot,
  BOOKING_STATES,
  CancellationTier,
  SegmentBaggagePolicy,
} from './booking-payment.adapter';

const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const validId = (value: string): boolean =>
  typeof value === 'string' && /^[a-f\d]{24}$/i.test(value);
const whole = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

/** Positive projection also strips accidental private fields from provider adapters. */
export function bookingPolicySnapshot(
  source: BookingPaymentSnapshot,
  kind: BookingKind,
  bookingId: string,
  userId: string,
): BookingPaymentSnapshot {
  try {
    if (
      !source ||
      !validId(source.id) ||
      !validId(source.userId) ||
      !validId(source.providerId) ||
      source.id.toLowerCase() !== bookingId.toLowerCase() ||
      source.userId.toLowerCase() !== userId.toLowerCase() ||
      source.kind !== kind ||
      !BOOKING_STATES.includes(source.state) ||
      typeof source.revision !== 'string' ||
      source.revision.trim().length === 0 ||
      !(source.holdExpiresAt instanceof Date) ||
      !Number.isFinite(source.holdExpiresAt.getTime()) ||
      !source.policies ||
      source.policies.type !== kind ||
      !Array.isArray(source.policies.cancellation)
    )
      throw new Error();
    assertPlatformMoney(source.amountMinor, source.currency);
    const cancellation: CancellationTier[] = source.policies.cancellation
      .map((tier) => {
        if (
          !tier ||
          !whole(tier.daysBefore) ||
          !Number.isFinite(tier.refundPercent) ||
          tier.refundPercent < 0 ||
          tier.refundPercent > 100
        )
          throw new Error();
        return {
          daysBefore: tier.daysBefore,
          refundPercent: tier.refundPercent,
        };
      })
      .sort((a, b) => a.daysBefore - b.daysBefore);
    if (
      new Set(cancellation.map((tier) => tier.daysBefore)).size !==
      cancellation.length
    )
      throw new Error();
    let policies: BookingPaymentSnapshot['policies'];
    if (source.policies.type === 'flight') {
      if (
        !Array.isArray(source.policies.baggage) ||
        source.policies.baggage.length === 0
      )
        throw new Error();
      const baggage: SegmentBaggagePolicy[] = source.policies.baggage.map(
        (policy) => {
          if (
            !policy ||
            typeof policy.segmentId !== 'string' ||
            !policy.segmentId.trim() ||
            typeof policy.cabin !== 'string' ||
            !policy.cabin.trim() ||
            !whole(policy.freeBagCount) ||
            !Number.isFinite(policy.maxWeightKg) ||
            policy.maxWeightKg <= 0 ||
            !whole(policy.maxExtraBags)
          )
            throw new Error();
          assertPlatformMoney(policy.extraBagPriceMinor, PLATFORM_CURRENCY);
          return {
            segmentId: policy.segmentId,
            cabin: policy.cabin,
            freeBagCount: policy.freeBagCount,
            maxWeightKg: policy.maxWeightKg,
            extraBagPriceMinor: policy.extraBagPriceMinor,
            maxExtraBags: policy.maxExtraBags,
          };
        },
      );
      if (
        new Set(baggage.map((policy) => policy.segmentId)).size !==
        baggage.length
      )
        throw new Error();
      policies = { type: 'flight', cancellation, baggage };
    } else {
      if (
        !time.test(source.policies.checkInTime) ||
        !time.test(source.policies.checkOutTime)
      )
        throw new Error();
      policies = {
        type: 'hotel',
        cancellation,
        checkInTime: source.policies.checkInTime,
        checkOutTime: source.policies.checkOutTime,
      };
    }
    return {
      id: new Types.ObjectId(source.id).toHexString(),
      kind,
      userId: new Types.ObjectId(source.userId).toHexString(),
      providerId: new Types.ObjectId(source.providerId).toHexString(),
      state: source.state,
      revision: source.revision,
      amountMinor: source.amountMinor,
      currency: PLATFORM_CURRENCY,
      holdExpiresAt: new Date(source.holdExpiresAt.getTime()),
      policies,
    };
  } catch {
    throw new BadGatewayException(
      'Booking payment adapter returned invalid policy data',
    );
  }
}

export function bookingPolicyToken(snapshot: BookingPaymentSnapshot): string {
  // The state is deliberately excluded so the accepted policy remains recognizable
  // after confirmation/expiry. Any quote, policy, ownership or deadline edit changes it.
  const binding = {
    id: snapshot.id,
    kind: snapshot.kind,
    userId: snapshot.userId,
    providerId: snapshot.providerId,
    revision: snapshot.revision,
    amountMinor: snapshot.amountMinor,
    currency: snapshot.currency,
    holdExpiresAt: snapshot.holdExpiresAt,
    policies: snapshot.policies,
  };
  return createHash('sha256').update(JSON.stringify(binding)).digest('hex');
}
