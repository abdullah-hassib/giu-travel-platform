import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, SortOrder, Types } from 'mongoose';
import { PAGE_SIZE, toPage } from '../../common/dto/page-number.dto';
import {
  OutboxEvent,
  outboxEvent,
} from '../../common/events/outbox-event.schema';
import { HotelsService } from '../hotels/hotels.service';
import { Hotel } from '../hotels/schemas/hotel.schema';
import { HotelRoom } from '../hotels/schemas/room.schema';
import {
  assertStay,
  cancellationRefund,
  isRoomOpen,
  todayUtc,
} from '../hotels/stay-rules';
import { PLATFORM_CURRENCY } from '../payments/platform-money';
import { PublicUser } from '../users/users.service';
import { bookingView } from './booking-view';
import {
  BookingGroup,
  CreateHotelBookingDto,
  MyBookingsQueryDto,
} from './dto/hotel-booking.dto';
import {
  BookedRoom,
  BookingStatus,
  HOLD_MINUTES,
  HotelBooking,
  occupying,
  refreshBookingStatuses,
} from './schemas/hotel-booking.schema';

const GROUPS: Record<
  BookingGroup,
  { statuses: BookingStatus[]; sort: Record<string, SortOrder> }
> = {
  upcoming: {
    statuses: ['Pending Payment', 'Confirmed'],
    sort: { checkIn: 1, _id: 1 },
  },
  past: { statuses: ['Completed', 'Expired'], sort: { checkIn: -1, _id: -1 } },
  cancelled: { statuses: ['Cancelled'], sort: { cancelledAt: -1, _id: -1 } },
};

@Injectable()
export class HotelBookingsService {
  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(HotelRoom.name) private readonly rooms: Model<HotelRoom>,
    @InjectModel(OutboxEvent.name) private readonly outbox: Model<OutboxEvent>,
    @InjectConnection() private readonly connection: Connection,
    private readonly hotelAccess: HotelsService,
  ) {}

  /**
   * HTL-16/HTL-18: hold all selected rooms together for ten minutes as one
   * Pending Payment reservation, or hold nothing at all.
   *
   * Concurrency: inside the transaction every selected room document is written
   * first. Two requests for the same room therefore write-conflict; MongoDB retries
   * the loser, which then sees the winner's hold and fails with 409. Any error
   * aborts the whole transaction, so a multi-room request never half-succeeds.
   */
  async create(user: PublicUser, dto: CreateHotelBookingDto) {
    const stay = { from: dto.checkIn, to: dto.checkOut };
    const nights = assertStay(stay);
    const roomIds = dto.rooms.map((room) => room.roomId.toLowerCase());
    if (new Set(roomIds).size !== roomIds.length) {
      throw new BadRequestException('Each room can only be selected once');
    }
    if (!dto.rooms.some((room) => room.adults > 0)) {
      throw new BadRequestException('A reservation needs at least one adult');
    }
    if (
      dto.rooms.some((room) => room.adults + room.childrenAges.length === 0)
    ) {
      throw new BadRequestException(
        'Every selected room needs at least one guest',
      );
    }

    const booking = await this.connection.transaction(async (session) => {
      const now = new Date();
      const hotel = await this.hotels
        .findOne({ _id: dto.hotelId, active: true })
        .session(session)
        .lean();
      if (!hotel) throw new NotFoundException('Hotel not found');

      const booked: BookedRoom[] = [];
      for (const request of dto.rooms) {
        const room = await this.rooms
          .findOneAndUpdate(
            { _id: request.roomId, hotelId: hotel._id, active: true },
            { $inc: { inventoryVersion: 1 } },
            { new: true, session },
          )
          .lean();
        if (!room) throw new NotFoundException('Room not found in this hotel');
        if (request.adults + request.childrenAges.length > room.maxOccupancy) {
          throw new BadRequestException(
            `Room ${room.name} fits at most ${room.maxOccupancy} guests`,
          );
        }
        if (!isRoomOpen(room, stay)) {
          throw new ConflictException(
            `Room ${room.name} is not available for these dates`,
          );
        }
        booked.push({
          roomId: room._id,
          name: room.name,
          type: room.type,
          adults: request.adults,
          childrenAges: request.childrenAges,
          pricePerNightMinor: room.pricePerNightMinor,
          subtotalMinor: room.pricePerNightMinor * nights,
        });
      }

      const taken = await this.bookings
        .exists({
          'rooms.roomId': { $in: booked.map((room) => room.roomId) },
          ...occupying(stay, now),
        })
        .session(session);
      if (taken)
        throw new ConflictException(
          'One or more rooms are already reserved for these dates',
        );

      const [created] = await this.bookings.create(
        [
          {
            userId: user.id,
            guestName: user.fullName,
            hotelId: hotel._id,
            hotelName: hotel.name,
            status: 'Pending Payment',
            checkIn: dto.checkIn,
            checkOut: dto.checkOut,
            nights,
            rooms: booked,
            totalMinor: booked.reduce(
              (sum, room) => sum + room.subtotalMinor,
              0,
            ),
            currency: PLATFORM_CURRENCY,
            holdExpiresAt: new Date(now.getTime() + HOLD_MINUTES * 60_000),
            policies: {
              checkInTime: hotel.checkInTime,
              checkOutTime: hotel.checkOutTime,
              cancellationTiers: hotel.cancellationTiers,
            },
          },
        ],
        { session },
      );
      return created.toObject();
    });
    return bookingView(booking);
  }

  /** HTL-20: the user's own reservations, grouped as Upcoming, Past or Cancelled. */
  async listMine(user: PublicUser, query: MyBookingsQueryDto) {
    await refreshBookingStatuses(this.bookings);
    const group = GROUPS[query.group];
    const filter = {
      userId: new Types.ObjectId(user.id),
      status: { $in: group.statuses },
    };
    const [rows, total] = await Promise.all([
      this.bookings
        .find(filter)
        .sort(group.sort)
        .skip((query.page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean(),
      this.bookings.countDocuments(filter),
    ]);
    return toPage(
      rows.map((row) => bookingView(row)),
      query.page,
      total,
    );
  }

  /**
   * HTL-20/ACC-11: the owner, an admin or the hotel's own moderator may read a booking.
   * Everyone else gets 404, so other people's bookings are not even confirmed to exist.
   */
  async getForViewer(user: PublicUser, bookingId: string) {
    await refreshBookingStatuses(this.bookings);
    const booking = await this.bookings.findById(bookingId).lean();
    const allowed =
      booking &&
      (booking.userId.equals(user.id) ||
        (await this.hotelAccess.canManage(
          user,
          booking.hotelId.toString(),
          true,
        )));
    if (!booking || !allowed) throw new NotFoundException('Booking not found');
    return bookingView(booking);
  }

  /**
   * HTL-21: cancel a whole Confirmed reservation before the check-in date. The refund
   * follows the cancellation tiers saved with the booking, applied to the full total.
   * The rooms are free again as soon as the status is Cancelled.
   */
  async cancel(user: PublicUser, bookingId: string) {
    await refreshBookingStatuses(this.bookings);
    const cancelled = await this.connection.transaction(async (session) => {
      const booking = await this.bookings
        .findOne({ _id: bookingId, userId: user.id })
        .session(session)
        .lean();
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.status !== 'Confirmed') {
        throw new ConflictException(
          'Only confirmed reservations can be cancelled',
        );
      }
      const today = todayUtc();
      if (booking.checkIn <= today) {
        throw new ConflictException(
          'Reservations can only be cancelled before the check-in date',
        );
      }
      const refund = cancellationRefund(
        booking.totalMinor,
        booking.policies.cancellationTiers,
        booking.checkIn,
        today,
      );
      const updated = await this.bookings
        .findOneAndUpdate(
          { _id: booking._id, status: 'Confirmed' },
          { $set: { status: 'Cancelled', cancelledAt: new Date(), ...refund } },
          { new: true, session },
        )
        .lean();
      if (!updated)
        throw new ConflictException(
          'The reservation changed; reload and try again',
        );
      // The payment service issues the Stripe refund (PAY-03) for refundMinor.
      await this.outbox.create(
        [
          outboxEvent('hotel_booking.cancelled', user.id, {
            bookingId: updated._id.toString(),
            reference: updated.reference ?? null,
            userId: updated.userId.toString(),
            hotelId: updated.hotelId.toString(),
            paymentId: updated.paymentId ?? null,
            reason: 'user_cancellation',
            ...refund,
            currency: updated.currency,
          }),
        ],
        { session },
      );
      return updated;
    });
    return bookingView(cancelled);
  }
}
