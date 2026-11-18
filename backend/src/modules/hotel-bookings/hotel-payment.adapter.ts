import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model, Types } from 'mongoose';
import { randomBytes } from 'node:crypto';
import {
  OutboxEvent,
  outboxEvent,
} from '../../common/events/outbox-event.schema';
import { HotelRoom } from '../hotels/schemas/room.schema';
import { HotelBooking } from './schemas/hotel-booking.schema';

type StoredBooking = HotelBooking & { _id: Types.ObjectId };

/**
 * Hotel implementation of Hassib's BookingSettlementAdapter
 * (payments/booking-payment.adapter.ts, still on his payment branch).
 * After that branch is merged, register it in PaymentsModule under
 * BOOKING_PAYMENT_ADAPTERS. Every method uses the payment service's session, so
 * booking, inventory and payment state commit together. Bookings are only ever
 * confirmed here, after the payment service has verified the Stripe payment.
 */
@Injectable()
export class HotelPaymentAdapter {
  readonly kind = 'hotel' as const;

  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    @InjectModel(HotelRoom.name) private readonly rooms: Model<HotelRoom>,
    @InjectModel(OutboxEvent.name) private readonly outbox: Model<OutboxEvent>,
  ) {}

  async getOwned(userId: string, bookingId: string) {
    const booking = await this.bookings
      .findOne({ _id: bookingId, userId })
      .lean();
    if (!booking) throw new NotFoundException('Booking not found');
    return snapshot(booking);
  }

  /** Writes the booking first so concurrent changes to it conflict with the caller's transaction. */
  async getOwnedForUpdate(
    userId: string,
    bookingId: string,
    session: ClientSession,
  ) {
    const booking = await this.bookings
      .findOneAndUpdate(
        { _id: bookingId, userId },
        { $inc: { paymentFence: 1 } },
        { new: true, session },
      )
      .lean();
    if (!booking) throw new NotFoundException('Booking not found');
    return snapshot(booking);
  }

  /** Links one payment to a live hold. Linking the same payment again is a no-op. */
  async linkPayment(
    userId: string,
    bookingId: string,
    paymentId: string,
    session: ClientSession,
  ) {
    const result = await this.bookings.updateOne(
      {
        _id: bookingId,
        userId,
        status: 'Pending Payment',
        holdExpiresAt: { $gt: new Date() },
        $or: [{ paymentId: { $exists: false } }, { paymentId }],
      },
      { $set: { paymentId } },
      { session },
    );
    if (result.matchedCount === 0) {
      await this.getOwned(userId, bookingId);
      throw new ConflictException('This reservation can no longer be paid');
    }
  }

  /**
   * HTL-17: turn a still-valid hold into a Confirmed reservation with a unique reference.
   * A hold that lapsed before payment is marked Expired instead, and the payment
   * service refunds it. The room write serializes this with any new hold on the same
   * rooms, so a lapsed hold can never be confirmed over someone else's booking.
   */
  async confirmPayment(
    userId: string,
    bookingId: string,
    paymentId: string,
    session: ClientSession,
  ): Promise<'Confirmed' | 'Expired'> {
    const booking = await this.bookings
      .findOne({ _id: bookingId, userId })
      .session(session)
      .lean();
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.paymentId !== paymentId) {
      throw new ConflictException(
        'This payment is not linked to the reservation',
      );
    }
    if (booking.status === 'Confirmed' || booking.status === 'Completed')
      return 'Confirmed';
    if (booking.status !== 'Pending Payment') return 'Expired';

    await this.rooms.updateMany(
      { _id: { $in: booking.rooms.map((room) => room.roomId) } },
      { $inc: { inventoryVersion: 1 } },
      { session },
    );
    const now = new Date();
    if (booking.holdExpiresAt <= now) {
      await this.bookings.updateOne(
        { _id: booking._id },
        { $set: { status: 'Expired' } },
        { session },
      );
      return 'Expired';
    }
    const reference = `HTL-${randomBytes(4).toString('hex').toUpperCase()}`;
    await this.bookings.updateOne(
      { _id: booking._id },
      { $set: { status: 'Confirmed', reference, confirmedAt: now } },
      { session },
    );
    await this.outbox.create(
      [
        outboxEvent('hotel_booking.confirmed', null, {
          bookingId: booking._id.toString(),
          reference,
          userId: booking.userId.toString(),
          hotelId: booking.hotelId.toString(),
          hotelName: booking.hotelName,
          checkIn: booking.checkIn,
          checkOut: booking.checkOut,
          rooms: booking.rooms.map((room) => room.name),
          totalMinor: booking.totalMinor,
          currency: booking.currency,
        }),
      ],
      { session },
    );
    return 'Confirmed';
  }

  /** Pending Payment -> Expired only; calling it again changes nothing. */
  async expirePayment(
    userId: string,
    bookingId: string,
    paymentId: string,
    session: ClientSession,
  ) {
    await this.bookings.updateOne(
      { _id: bookingId, userId, paymentId, status: 'Pending Payment' },
      { $set: { status: 'Expired' } },
      { session },
    );
  }
}

/** The authoritative quote the payment service charges. It never changes after the hold is made. */
function snapshot(booking: StoredBooking) {
  return {
    id: booking._id.toString(),
    kind: 'hotel' as const,
    userId: booking.userId.toString(),
    providerId: booking.hotelId.toString(),
    state: booking.status,
    revision: '1',
    amountMinor: booking.totalMinor,
    currency: booking.currency,
    holdExpiresAt: booking.holdExpiresAt,
    policies: {
      type: 'hotel' as const,
      cancellation: booking.policies.cancellationTiers.map(
        ({ daysBefore, refundPercent }) => ({
          daysBefore,
          refundPercent,
        }),
      ),
      checkInTime: booking.policies.checkInTime,
      checkOutTime: booking.policies.checkOutTime,
    },
  };
}
