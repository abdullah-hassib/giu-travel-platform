import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { randomBytes } from 'node:crypto';
import { Flight } from '../flights/schemas/flight.schema';
import { FlightBooking } from './schemas/flight-booking.schema';
import {
  BookingPaymentSnapshot,
  BookingSettlementAdapter,
} from '../payments/booking-payment.adapter';
import { DomainEventPublisherService } from '../domain-events/domain-event-publisher.service';
import { publishEffects } from '../domain-events/publish-effects';

@Injectable()
export class FlightPaymentAdapter implements BookingSettlementAdapter {
  readonly kind = 'flight' as const;
  constructor(
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    private readonly events: DomainEventPublisherService,
  ) {}

  async getOwned(userId: string, id: string): Promise<BookingPaymentSnapshot> {
    const booking = await this.bookings.findOne({ _id: id, userId }).lean();
    if (!booking) throw new NotFoundException('Booking not found');
    return this.snapshot(booking);
  }

  async getOwnedForUpdate(
    userId: string,
    id: string,
    session: ClientSession,
  ): Promise<BookingPaymentSnapshot> {
    const booking = await this.bookings
      .findOneAndUpdate(
        { _id: id, userId },
        { $inc: { paymentFence: 1 } },
        { new: true, session },
      )
      .lean();
    if (!booking) throw new NotFoundException('Booking not found');
    return this.snapshot(booking);
  }

  async linkPayment(
    userId: string,
    id: string,
    paymentId: string,
    session: ClientSession,
  ): Promise<void> {
    const result = await this.bookings.updateOne(
      {
        _id: id,
        userId,
        status: 'Pending Payment',
        holdExpiresAt: { $gt: new Date() },
        $or: [{ paymentId: { $exists: false } }, { paymentId }],
      },
      { $set: { paymentId } },
      { session },
    );
    if (!result.matchedCount)
      throw new ConflictException('This booking can no longer be paid');
  }

  async confirmPayment(
    userId: string,
    id: string,
    paymentId: string,
    session: ClientSession,
  ): Promise<'Confirmed' | 'Expired'> {
    const booking = await this.bookings
      .findOne({ _id: id, userId, paymentId })
      .session(session)
      .lean();
    if (!booking)
      throw new ConflictException('Payment is not linked to this booking');
    if (booking.status === 'Confirmed' || booking.status === 'Completed')
      return 'Confirmed';
    if (booking.status !== 'Pending Payment') return 'Expired';
    const now = new Date();
    let available = booking.holdExpiresAt > now;
    for (const segment of booking.segments) {
      if (
        !(await this.flights
          .exists({
            _id: segment.flightId,
            status: 'Scheduled',
            departureAt: { $gt: now },
          })
          .session(session))
      )
        available = false;
    }
    if (!available) {
      await this.expireBooking(id, session);
      return 'Expired';
    }
    const reference = 'FLT-' + randomBytes(6).toString('hex').toUpperCase();
    const changed = await this.bookings.updateOne(
      { _id: id, status: 'Pending Payment' },
      {
        $set: {
          status: 'Confirmed',
          bookingReference: reference,
          confirmedAt: now,
        },
      },
      { session },
    );
    if (!changed.modifiedCount)
      throw new ConflictException('Booking changed during payment');
    for (const segment of booking.segments) {
      const result = await this.flights.updateOne(
        {
          _id: segment.flightId,
          status: 'Scheduled',
          departureAt: { $gt: now },
          cabins: {
            $elemMatch: {
              category: segment.cabinCategory,
              heldSeats: { $gte: segment.seatsReserved },
            },
          },
        },
        {
          $inc: {
            'cabins.$.heldSeats': -segment.seatsReserved,
            'cabins.$.bookedSeats': segment.seatsReserved,
            __v: 1,
          },
        },
        { session },
      );
      if (!result.modifiedCount)
        throw new ConflictException('Flight inventory changed during payment');
    }
    await publishEffects(
      this.events,
      session,
      'booking.confirmed',
      undefined,
      {
        action: 'booking.confirmed',
        resourceType: 'flight-booking',
        resourceId: id,
        outcome: 'success',
      },
      [
        {
          recipientId: userId,
          eventType: 'booking.confirmed',
          resourceType: 'flight-booking',
          resourceId: id,
          message: (
            'Your flight booking ' +
            reference +
            ' is Confirmed: ' +
            booking.segments
              .map(
                (s) =>
                  s.flightNumber +
                  ' ' +
                  s.departureAirportCode +
                  '–' +
                  s.arrivalAirportCode +
                  ' ' +
                  s.departureAt.toISOString(),
              )
              .join('; ')
          ).slice(0, 500),
        },
      ],
    );
    return 'Confirmed';
  }

  async expirePayment(
    userId: string,
    id: string,
    paymentId: string,
    session: ClientSession,
  ): Promise<void> {
    if (
      !(await this.bookings
        .exists({ _id: id, userId, paymentId })
        .session(session))
    )
      throw new ConflictException('Payment is not linked to this booking');
    await this.expireBooking(id, session);
  }

  /** Every path changes booking state first; retries can never release twice. */
  async expireBooking(id: string, session: ClientSession): Promise<void> {
    const booking = await this.bookings
      .findOneAndUpdate(
        { _id: id, status: 'Pending Payment' },
        { $set: { status: 'Expired' } },
        { session },
      )
      .lean();
    if (!booking) return;
    await this.release(booking, 'heldSeats', session);
  }

  async release(
    booking: Pick<FlightBooking, 'segments'>,
    field: 'heldSeats' | 'bookedSeats',
    session: ClientSession,
  ): Promise<void> {
    for (const segment of booking.segments) {
      const result = await this.flights.updateOne(
        {
          _id: segment.flightId,
          cabins: {
            $elemMatch: {
              category: segment.cabinCategory,
              [field]: { $gte: segment.seatsReserved },
            },
          },
        },
        {
          $inc: { ['cabins.$.' + field]: -segment.seatsReserved, __v: 1 },
        },
        { session },
      );
      if (!result.modifiedCount)
        throw new ConflictException(
          'Flight inventory does not match the reservation',
        );
    }
  }

  private snapshot(
    booking: FlightBooking & { _id: { toString(): string } },
  ): BookingPaymentSnapshot {
    return {
      id: booking._id.toString(),
      kind: 'flight',
      userId: booking.userId.toString(),
      providerId: booking.segments[0].airlineId.toString(),
      state: booking.status,
      revision: '1',
      amountMinor: booking.totalAmountMinor,
      currency: booking.currency,
      holdExpiresAt: booking.holdExpiresAt,
      policies: booking.policySnapshot,
    };
  }
}
