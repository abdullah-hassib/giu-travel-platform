import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { toPage, PAGE_SIZE } from '../../common/dto/page-number.dto';
import {
  OutboxEvent,
  outboxEvent,
} from '../../common/events/outbox-event.schema';
import {
  MAX_IMAGES_PER_ITEM,
  MediaService,
  UploadedImage,
} from '../media-uploads/media.service';
import { CITIES } from '../reference-data/official-reference';
import { PublicUser } from '../users/users.service';
import { PLATFORM_CURRENCY } from '../payments/platform-money';
import { bookingView } from '../hotel-bookings/booking-view';
import {
  HotelBooking,
  occupying,
  refreshBookingStatuses,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import {
  CreateHotelDto,
  HotelPoliciesDto,
  HotelSearchDto,
  OptionalStayQueryDto,
  ReservationsQueryDto,
  StayQueryDto,
  UpdateHotelDto,
} from './dto/hotel.dto';
import { averageRating, Hotel } from './schemas/hotel.schema';
import { HotelRoom } from './schemas/room.schema';
import { assertStay, isRoomOpen, NightRange } from './stay-rules';
import { DomainEventPublisherService } from '../domain-events/domain-event-publisher.service';
import { publishEffects } from '../domain-events/publish-effects';

type StoredHotel = Hotel & { _id: Types.ObjectId };
type StoredRoom = HotelRoom & { _id: Types.ObjectId };
type HotelProfileAction =
  | 'hotel.created'
  | 'hotel.updated'
  | 'hotel.policies_updated'
  | 'hotel.image_added'
  | 'hotel.image_removed';

@Injectable()
export class HotelsService {
  constructor(
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(HotelRoom.name) private readonly rooms: Model<HotelRoom>,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    @InjectModel(OutboxEvent.name) private readonly outbox: Model<OutboxEvent>,
    @InjectConnection() private readonly connection: Connection,
    private readonly media: MediaService,
    private readonly events: DomainEventPublisherService,
  ) {}

  private audit(
    session: ClientSession,
    actorId: string,
    hotelId: string,
    action: HotelProfileAction,
    metadata?: Record<string, string>,
  ): Promise<void> {
    return publishEffects(this.events, session, action, actorId, {
      action,
      resourceType: 'hotel',
      resourceId: hotelId,
      outcome: 'success',
      ...(metadata && { metadata }),
    });
  }

  /** A hotel moderator manages only the hotel assigned to them; admins optionally too. */
  async canManage(
    user: PublicUser,
    hotelId: string,
    allowAdmin = false,
  ): Promise<boolean> {
    if (allowAdmin && user.roles.includes('admin')) return true;
    if (!user.roles.includes('hotel_moderator')) return false;
    // Assignments are created with the moderator account by the administration module (ACC-13).
    const assignment = await this.connection
      .collection('moderator_assignments')
      .findOne({ userId: new Types.ObjectId(user.id), providerType: 'hotel' });
    return Boolean(
      assignment && new Types.ObjectId(hotelId).equals(assignment.providerId),
    );
  }

  async assertCanManage(
    user: PublicUser,
    hotelId: string,
    allowAdmin = false,
  ): Promise<void> {
    if (!(await this.canManage(user, hotelId, allowAdmin))) {
      throw new ForbiddenException('You can only manage your assigned hotel');
    }
  }

  async findOrFail(hotelId: string): Promise<StoredHotel> {
    const hotel = await this.hotels.findById(hotelId).lean();
    if (!hotel) throw new NotFoundException('Hotel not found');
    return hotel;
  }

  /** HTL-01: admins create hotel profiles. */
  async create(dto: CreateHotelDto, actorId: string) {
    assertCityInCountry(dto.cityId, dto.countryCode);
    return this.connection.transaction(async (session) => {
      const [hotel] = await this.hotels.create([dto], { session });
      await this.audit(session, actorId, hotel._id.toString(), 'hotel.created');
      return hotelView(hotel.toObject());
    });
  }

  /** HTL-01: the assigned moderator (or an admin) edits the profile. */
  async update(user: PublicUser, hotelId: string, dto: UpdateHotelDto) {
    await this.assertCanManage(user, hotelId, true);
    return this.connection.transaction(async (session) => {
      const hotel = await this.hotels.findById(hotelId).session(session).lean();
      if (!hotel) throw new NotFoundException('Hotel not found');
      assertCityInCountry(
        dto.cityId ?? hotel.cityId,
        dto.countryCode ?? hotel.countryCode,
      );
      const updated = await this.hotels
        .findByIdAndUpdate(
          hotelId,
          { $set: dto },
          { new: true, runValidators: true, session },
        )
        .lean();
      if (!updated) throw new NotFoundException('Hotel not found');
      await this.audit(session, user.id, hotelId, 'hotel.updated');
      return hotelView(updated);
    });
  }

  /**
   * ACC-15 support: deactivated hotels disappear from search and cannot be booked,
   * while existing reservations stay valid. Touching every room makes a booking that
   * is being created at the same moment conflict and retry against the new state.
   */
  async setActive(actorId: string, hotelId: string, active: boolean) {
    await this.connection.transaction(async (session) => {
      const changed = await this.hotels.findOneAndUpdate(
        { _id: hotelId, active: !active },
        { $set: { active } },
        { session },
      );
      if (!changed) {
        if (!(await this.hotels.exists({ _id: hotelId }).session(session))) {
          throw new NotFoundException('Hotel not found');
        }
        return; // already in the requested state
      }
      await this.rooms.updateMany(
        { hotelId },
        { $inc: { inventoryVersion: 1 } },
        { session },
      );
      await this.outbox.create(
        [
          outboxEvent(
            active ? 'hotel.reactivated' : 'hotel.deactivated',
            actorId,
            { hotelId },
          ),
        ],
        { session },
      );
    });
    return hotelView(await this.findOrFail(hotelId));
  }

  /** HTL-09/HTL-10. Existing reservations keep the policies they were booked under. */
  async setPolicies(user: PublicUser, hotelId: string, dto: HotelPoliciesDto) {
    await this.assertCanManage(user, hotelId);
    const thresholds = dto.cancellationTiers.map((tier) => tier.daysBefore);
    if (new Set(thresholds).size !== thresholds.length) {
      throw new BadRequestException(
        'Each cancellation tier needs a different daysBefore',
      );
    }
    const cancellationTiers = dto.cancellationTiers
      .map(({ daysBefore, refundPercent }) => ({ daysBefore, refundPercent }))
      .sort((a, b) => b.daysBefore - a.daysBefore);
    return this.connection.transaction(async (session) => {
      const updated = await this.hotels
        .findByIdAndUpdate(
          hotelId,
          {
            $set: {
              checkInTime: dto.checkInTime,
              checkOutTime: dto.checkOutTime,
              cancellationTiers,
            },
          },
          { new: true, runValidators: true, session },
        )
        .lean();
      if (!updated) throw new NotFoundException('Hotel not found');
      await this.audit(session, user.id, hotelId, 'hotel.policies_updated');
      return hotelView(updated);
    });
  }

  /** HTL-01 photos under GEN-08: at most five per hotel. */
  async addImage(
    user: PublicUser,
    hotelId: string,
    file: UploadedImage | undefined,
  ) {
    await this.assertCanManage(user, hotelId, true);
    await this.findOrFail(hotelId);
    const image = await this.media.saveImage(file);
    try {
      return await this.connection.transaction(async (session) => {
        const updated = await this.hotels
          .findOneAndUpdate(
            {
              _id: hotelId,
              [`images.${MAX_IMAGES_PER_ITEM - 1}`]: { $exists: false },
            },
            { $push: { images: image } },
            { new: true, session },
          )
          .lean();
        if (!updated) {
          throw new BadRequestException(
            `A hotel can have at most ${MAX_IMAGES_PER_ITEM} images`,
          );
        }
        await this.audit(session, user.id, hotelId, 'hotel.image_added', {
          imageId: image.id,
        });
        return hotelView(updated);
      });
    } catch (error) {
      await this.media.removeImage(image.id);
      throw error;
    }
  }

  async removeImage(user: PublicUser, hotelId: string, imageId: string) {
    await this.assertCanManage(user, hotelId, true);
    const result = await this.connection.transaction(async (session) => {
      const updated = await this.hotels
        .findOneAndUpdate(
          { _id: hotelId, 'images.id': imageId },
          { $pull: { images: { id: imageId } } },
          { new: true, session },
        )
        .lean();
      if (!updated) throw new NotFoundException('Image not found');
      await this.audit(session, user.id, hotelId, 'hotel.image_removed', {
        imageId,
      });
      return hotelView(updated);
    });
    await this.media.removeImage(imageId);
    return result;
  }

  /** HTL-02: public details, plus the free rooms when dates are given. */
  async getPublic(hotelId: string, query: OptionalStayQueryDto) {
    const hotel = await this.findActive(hotelId);
    if (Boolean(query.checkIn) !== Boolean(query.checkOut)) {
      throw new BadRequestException(
        'Send both checkIn and checkOut, or neither',
      );
    }
    if (!query.checkIn || !query.checkOut) return hotelView(hotel);
    const availableRooms = await this.roomsForStay(hotel, {
      from: query.checkIn,
      to: query.checkOut,
    });
    return { ...hotelView(hotel), availableRooms };
  }

  /** HTL-15: rooms free for the whole stay, with their total stay price. */
  async availableRooms(hotelId: string, query: StayQueryDto) {
    const hotel = await this.findActive(hotelId);
    return this.roomsForStay(hotel, {
      from: query.checkIn,
      to: query.checkOut,
    });
  }

  /**
   * HTL-11/HTL-12: active hotels in the city/country with at least `rooms` free rooms
   * whose largest combined occupancy fits the guests. The shown price is the cheapest
   * free room per night. Filtering and sorting happen in memory, which is fine for
   * the number of hotels a single city has on this platform.
   */
  async search(query: HotelSearchDto) {
    if (!query.cityId && !query.countryCode) {
      throw new BadRequestException('Search by cityId or countryCode');
    }
    if (
      query.minPriceMinor !== undefined &&
      query.maxPriceMinor !== undefined &&
      query.minPriceMinor > query.maxPriceMinor
    ) {
      throw new BadRequestException(
        'minPriceMinor cannot be greater than maxPriceMinor',
      );
    }
    const stay = { from: query.checkIn, to: query.checkOut };
    assertStay(stay);

    const hotels = await this.hotels
      .find({
        active: true,
        ...(query.cityId && { cityId: query.cityId }),
        ...(query.countryCode && { countryCode: query.countryCode }),
      })
      .lean();
    const freeRooms = await this.freeRooms(
      hotels.map((hotel) => hotel._id),
      stay,
    );

    const results = [];
    for (const hotel of hotels) {
      const rooms = freeRooms.filter((room) => room.hotelId.equals(hotel._id));
      if (rooms.length < query.rooms) continue;
      const capacity = rooms
        .map((room) => room.maxOccupancy)
        .sort((a, b) => b - a)
        .slice(0, query.rooms)
        .reduce((sum, occupancy) => sum + occupancy, 0);
      if (capacity < query.guests) continue;
      const price = Math.min(...rooms.map((room) => room.pricePerNightMinor));
      const rating = averageRating(hotel);
      if (query.minPriceMinor !== undefined && price < query.minPriceMinor)
        continue;
      if (query.maxPriceMinor !== undefined && price > query.maxPriceMinor)
        continue;
      if (
        query.minRating !== undefined &&
        (rating === null || rating < query.minRating)
      )
        continue;
      results.push({
        id: hotel._id.toString(),
        name: hotel.name,
        cityId: hotel.cityId,
        countryCode: hotel.countryCode,
        address: hotel.address,
        starRating: hotel.starRating,
        image: hotel.images[0]?.url ?? null,
        averageRating: rating,
        ratingCount: hotel.ratingCount,
        freeRooms: rooms.length,
        pricePerNightMinor: price,
        currency: PLATFORM_CURRENCY,
      });
    }

    const direction =
      (query.order ?? (query.sortBy === 'rating' ? 'desc' : 'asc')) === 'asc'
        ? 1
        : -1;
    results.sort((a, b) => {
      if (query.sortBy === 'rating' && a.averageRating !== b.averageRating) {
        if (a.averageRating === null) return 1; // unrated hotels always last
        if (b.averageRating === null) return -1;
        return direction * (a.averageRating - b.averageRating);
      }
      if (
        query.sortBy === 'price' &&
        a.pricePerNightMinor !== b.pricePerNightMinor
      ) {
        return direction * (a.pricePerNightMinor - b.pricePerNightMinor);
      }
      return a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
    });
    const start = (query.page - 1) * PAGE_SIZE;
    return toPage(
      results.slice(start, start + PAGE_SIZE),
      query.page,
      results.length,
    );
  }

  /** HTL-22: the assigned moderator (or an admin) sees the hotel's reservations. */
  async reservations(
    user: PublicUser,
    hotelId: string,
    query: ReservationsQueryDto,
  ) {
    await this.assertCanManage(user, hotelId, true);
    await refreshBookingStatuses(this.bookings);
    const filter = {
      hotelId: new Types.ObjectId(hotelId),
      ...(query.status && { status: query.status }),
    };
    const [rows, total] = await Promise.all([
      this.bookings
        .find(filter)
        .sort({ checkIn: -1, _id: -1 })
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
   * For the administration module's ACC-13 provider adapter: confirm the hotel exists
   * with a write inside the caller's transaction, so it cannot change underneath it.
   */
  async lockExisting(hotelId: string, session: ClientSession) {
    const hotel = await this.hotels.findOneAndUpdate(
      { _id: hotelId },
      { $currentDate: { updatedAt: true } },
      { session },
    );
    if (!hotel) throw new NotFoundException('Hotel not found');
    return { id: hotel._id.toString(), kind: 'hotel' as const };
  }

  private async findActive(hotelId: string): Promise<StoredHotel> {
    const hotel = await this.hotels
      .findOne({ _id: hotelId, active: true })
      .lean();
    if (!hotel) throw new NotFoundException('Hotel not found');
    return hotel;
  }

  private async roomsForStay(hotel: StoredHotel, stay: NightRange) {
    const nights = assertStay(stay);
    const rooms = await this.freeRooms([hotel._id], stay);
    return rooms
      .sort(
        (a, b) =>
          a.pricePerNightMinor - b.pricePerNightMinor ||
          a.name.localeCompare(b.name),
      )
      .map((room) => ({
        id: room._id.toString(),
        name: room.name,
        type: room.type,
        beds: room.beds,
        maxOccupancy: room.maxOccupancy,
        pricePerNightMinor: room.pricePerNightMinor,
        totalMinor: room.pricePerNightMinor * nights,
        currency: PLATFORM_CURRENCY,
      }));
  }

  /** Active rooms that are open for the stay and not held or booked by anyone. */
  private async freeRooms(
    hotelIds: Types.ObjectId[],
    stay: NightRange,
  ): Promise<StoredRoom[]> {
    const rooms = await this.rooms
      .find({ hotelId: { $in: hotelIds }, active: true })
      .lean();
    const busy = await this.bookings.distinct('rooms.roomId', {
      'rooms.roomId': { $in: rooms.map((room) => room._id) },
      ...occupying(stay),
    });
    const busyIds = new Set(busy.map(String));
    return rooms.filter(
      (room) => !busyIds.has(room._id.toString()) && isRoomOpen(room, stay),
    );
  }
}

function assertCityInCountry(cityId: string, countryCode: string): void {
  const city = CITIES.find((entry) => entry.id === cityId);
  if (city?.countryCode !== countryCode) {
    throw new BadRequestException(
      'The city does not belong to the selected country',
    );
  }
}

export function hotelView(hotel: StoredHotel) {
  return {
    id: hotel._id.toString(),
    name: hotel.name,
    description: hotel.description,
    address: hotel.address,
    cityId: hotel.cityId,
    countryCode: hotel.countryCode,
    starRating: hotel.starRating,
    amenities: hotel.amenities,
    images: hotel.images.map(({ id, url }) => ({ id, url })),
    checkInTime: hotel.checkInTime,
    checkOutTime: hotel.checkOutTime,
    cancellationTiers: hotel.cancellationTiers.map(
      ({ daysBefore, refundPercent }) => ({
        daysBefore,
        refundPercent,
      }),
    ),
    active: hotel.active,
    averageRating: averageRating(hotel),
    ratingCount: hotel.ratingCount,
  };
}
