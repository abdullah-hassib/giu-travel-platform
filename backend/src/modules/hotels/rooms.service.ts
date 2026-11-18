import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
  PAGE_SIZE,
  PageNumberDto,
  toPage,
} from '../../common/dto/page-number.dto';
import { isDuplicateKey } from '../../common/mongo-helpers';
import { PLATFORM_CURRENCY } from '../payments/platform-money';
import { PublicUser } from '../users/users.service';
import {
  HotelBooking,
  occupying,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import { AvailabilityQueryDto } from './dto/hotel.dto';
import {
  CreateRoomDto,
  NightRangeDto,
  UpdateRoomAvailabilityDto,
  UpdateRoomDto,
} from './dto/room.dto';
import { HotelsService } from './hotels.service';
import { HotelRoom } from './schemas/room.schema';
import {
  addDays,
  assertNoOverlaps,
  assertRange,
  covers,
  daysBetween,
  NightRange,
  overlaps,
  todayUtc,
} from './stay-rules';

type StoredRoom = HotelRoom & { _id: Types.ObjectId };

const MAX_VIEW_NIGHTS = 31;
const FOREVER = '9999-12-31';

@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(HotelRoom.name) private readonly rooms: Model<HotelRoom>,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    @InjectConnection() private readonly connection: Connection,
    private readonly hotels: HotelsService,
  ) {}

  async list(user: PublicUser, hotelId: string, query: PageNumberDto) {
    await this.hotels.assertCanManage(user, hotelId, true);
    const filter = { hotelId: new Types.ObjectId(hotelId) };
    const [rows, total] = await Promise.all([
      this.rooms
        .find(filter)
        .sort({ name: 1 })
        .skip((query.page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean(),
      this.rooms.countDocuments(filter),
    ]);
    return toPage(rows.map(roomView), query.page, total);
  }

  /** HTL-03 */
  async create(user: PublicUser, hotelId: string, dto: CreateRoomDto) {
    await this.hotels.assertCanManage(user, hotelId);
    await this.hotels.findOrFail(hotelId);
    try {
      const room = await this.rooms.create({ ...dto, hotelId });
      return roomView(room.toObject());
    } catch (error) {
      throw duplicateName(error);
    }
  }

  /** HTL-05/HTL-06: edit details; deactivation is refused while the room has reservations ahead. */
  async update(
    user: PublicUser,
    hotelId: string,
    roomId: string,
    dto: UpdateRoomDto,
  ) {
    await this.hotels.assertCanManage(user, hotelId);
    try {
      return await this.connection.transaction(async (session) => {
        const room = await this.lockRoom(hotelId, roomId, session);
        if (dto.active === false && room.active) {
          const upcoming = await this.reservationsOf(
            room._id,
            { from: todayUtc(), to: FOREVER },
            session,
          );
          if (upcoming.length > 0) {
            throw new ConflictException(
              'This room has upcoming reservations and cannot be deactivated',
            );
          }
        }
        const updated = await this.rooms
          .findByIdAndUpdate(
            room._id,
            { $set: dto },
            { new: true, runValidators: true, session },
          )
          .lean();
        return roomView(updated!);
      });
    } catch (error) {
      throw duplicateName(error);
    }
  }

  /** HTL-06: only rooms that were never reserved can be deleted. */
  async remove(
    user: PublicUser,
    hotelId: string,
    roomId: string,
  ): Promise<void> {
    await this.hotels.assertCanManage(user, hotelId);
    await this.connection.transaction(async (session) => {
      const room = await this.lockRoom(hotelId, roomId, session);
      if (
        await this.bookings
          .exists({ 'rooms.roomId': room._id })
          .session(session)
      ) {
        throw new ConflictException(
          'This room has been reserved before; deactivate it instead',
        );
      }
      await this.rooms.deleteOne({ _id: room._id }, { session });
    });
  }

  /** HTL-04: add one bookable range that must not overlap the room's existing ranges. */
  async addAvailability(
    user: PublicUser,
    hotelId: string,
    roomId: string,
    dto: NightRangeDto,
  ) {
    await this.hotels.assertCanManage(user, hotelId);
    const range = { from: dto.from, to: dto.to };
    assertRange(range);
    const updated = await this.rooms
      .findOneAndUpdate(
        {
          _id: roomId,
          hotelId,
          availability: {
            $not: {
              $elemMatch: { from: { $lt: range.to }, to: { $gt: range.from } },
            },
          },
        },
        { $push: { availability: range }, $inc: { inventoryVersion: 1 } },
        { new: true },
      )
      .lean();
    if (updated) return roomView(updated);
    if (await this.rooms.exists({ _id: roomId, hotelId })) {
      throw new ConflictException(
        'This range overlaps an existing availability range',
      );
    }
    throw new NotFoundException('Room not found');
  }

  /**
   * HTL-05/HTL-06: replace the bookable and/or blocked ranges. Reserved nights must stay
   * bookable, and blocked ranges must not touch a Confirmed stay or an unexpired hold.
   */
  async updateAvailability(
    user: PublicUser,
    hotelId: string,
    roomId: string,
    dto: UpdateRoomAvailabilityDto,
  ) {
    await this.hotels.assertCanManage(user, hotelId);
    if (!dto.availability && !dto.blocked) {
      throw new BadRequestException('Send availability and/or blocked ranges');
    }
    const availability = dto.availability?.map(({ from, to }) => ({
      from,
      to,
    }));
    const blocked = dto.blocked?.map(({ from, to }) => ({ from, to }));
    if (availability) assertNoOverlaps(availability);
    blocked?.forEach(assertRange);

    return this.connection.transaction(async (session) => {
      const room = await this.lockRoom(hotelId, roomId, session);
      const today = todayUtc();
      const reserved = await this.reservationsOf(
        room._id,
        { from: today, to: FOREVER },
        session,
      );
      for (const booking of reserved) {
        const remaining = {
          from: booking.checkIn > today ? booking.checkIn : today,
          to: booking.checkOut,
        };
        if (availability && !covers(availability, remaining)) {
          throw new ConflictException(
            'Availability cannot be removed for reserved dates',
          );
        }
        if (blocked?.some((range) => overlaps(range, remaining))) {
          throw new ConflictException(
            'Blocked dates overlap an existing reservation',
          );
        }
      }
      const updated = await this.rooms
        .findByIdAndUpdate(
          room._id,
          {
            $set: {
              ...(availability && { availability }),
              ...(blocked && { blocked }),
            },
          },
          { new: true, session },
        )
        .lean();
      return roomView(updated!);
    });
  }

  /** HTL-08: each room's status per night - Available, Booked (with reference), Blocked or Unavailable. */
  async availabilityView(
    user: PublicUser,
    hotelId: string,
    query: AvailabilityQueryDto,
  ) {
    await this.hotels.assertCanManage(user, hotelId, true);
    const range = { from: query.from, to: query.to };
    assertRange(range);
    const nights = daysBetween(range.from, range.to);
    if (nights > MAX_VIEW_NIGHTS) {
      throw new BadRequestException(`Choose at most ${MAX_VIEW_NIGHTS} nights`);
    }
    const filter = { hotelId: new Types.ObjectId(hotelId) };
    const [rooms, total, bookings] = await Promise.all([
      this.rooms
        .find(filter)
        .sort({ name: 1 })
        .skip((query.page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean(),
      this.rooms.countDocuments(filter),
      this.bookings.find({ ...filter, ...occupying(range) }).lean(),
    ]);
    const dates = Array.from({ length: nights }, (_, index) =>
      addDays(range.from, index),
    );
    const data = rooms.map((room) => ({
      roomId: room._id.toString(),
      name: room.name,
      active: room.active,
      nights: dates.map((date) => {
        const night = { from: date, to: addDays(date, 1) };
        const booking = bookings.find(
          (entry) =>
            entry.rooms.some((booked) => booked.roomId.equals(room._id)) &&
            overlaps(night, { from: entry.checkIn, to: entry.checkOut }),
        );
        if (booking) {
          return {
            date,
            status: 'Booked',
            bookingId: booking._id.toString(),
            reference: booking.reference ?? null,
          };
        }
        if (room.blocked.some((blockedRange) => overlaps(blockedRange, night)))
          return { date, status: 'Blocked' };
        return {
          date,
          status: covers(room.availability, night)
            ? 'Available'
            : 'Unavailable',
        };
      }),
    }));
    return toPage(data, query.page, total);
  }

  /** Writes the room so any concurrent booking or inventory change on it must serialize. */
  private async lockRoom(
    hotelId: string,
    roomId: string,
    session: ClientSession,
  ): Promise<StoredRoom> {
    const room = await this.rooms
      .findOneAndUpdate(
        { _id: roomId, hotelId },
        { $inc: { inventoryVersion: 1 } },
        { new: true, session },
      )
      .lean();
    if (!room) throw new NotFoundException('Room not found');
    return room;
  }

  private reservationsOf(
    roomId: Types.ObjectId,
    range: NightRange,
    session: ClientSession,
  ) {
    return this.bookings
      .find({ 'rooms.roomId': roomId, ...occupying(range) })
      .session(session)
      .lean();
  }
}

function duplicateName(error: unknown): unknown {
  return isDuplicateKey(error)
    ? new ConflictException('A room with this name already exists in the hotel')
    : error;
}

export function roomView(room: StoredRoom) {
  return {
    id: room._id.toString(),
    hotelId: room.hotelId.toString(),
    name: room.name,
    type: room.type,
    beds: room.beds,
    maxOccupancy: room.maxOccupancy,
    pricePerNightMinor: room.pricePerNightMinor,
    currency: PLATFORM_CURRENCY,
    availability: room.availability.map(({ from, to }) => ({ from, to })),
    blocked: room.blocked.map(({ from, to }) => ({ from, to })),
    active: room.active,
  };
}
