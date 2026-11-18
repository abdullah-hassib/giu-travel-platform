import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import {
  HotelBooking,
  BookingStatus,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import { todayUtc } from '../hotels/stay-rules';
import {
  AdminBookingsPageDto,
  AdminBookingsQueryDto,
  AdminBookingViewDto,
} from './dto/admin-bookings.dto';

/** Read-only hotel projection using MK's supplied schema, without modifying his domain service. */
@Injectable()
export class HotelAdminBookingsService {
  constructor(
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
  ) {}

  async list(query: AdminBookingsQueryDto): Promise<AdminBookingsPageDto> {
    if (query.from && query.to && query.from > query.to)
      throw new BadRequestException('from cannot be after to');
    const filter: FilterQuery<
      HotelBooking & { effectiveStatus: BookingStatus }
    > = {};
    if (query.status) filter.effectiveStatus = query.status;
    if (query.from || query.to)
      filter.checkIn = {
        ...(query.from && { $gte: query.from }),
        ...(query.to && { $lte: query.to }),
      };
    const [result] = await this.bookings
      .aggregate<{ data: AdminBookingViewDto[]; count: { total: number }[] }>([
        {
          $addFields: {
            effectiveStatus: {
              $switch: {
                branches: [
                  {
                    case: {
                      $and: [
                        { $eq: ['$status', 'Pending Payment'] },
                        { $lte: ['$holdExpiresAt', new Date()] },
                      ],
                    },
                    then: 'Expired',
                  },
                  {
                    case: {
                      $and: [
                        { $eq: ['$status', 'Confirmed'] },
                        { $lt: ['$checkOut', todayUtc()] },
                      ],
                    },
                    then: 'Completed',
                  },
                ],
                default: '$status',
              },
            },
          },
        },
        { $match: filter },
        {
          $facet: {
            data: [
              { $sort: { createdAt: -1, _id: -1 } },
              { $skip: (query.page - 1) * 10 },
              { $limit: 10 },
              {
                $project: {
                  _id: 0,
                  id: { $toString: '$_id' },
                  type: { $literal: 'hotel' },
                  reference: { $ifNull: ['$reference', null] },
                  user: { id: { $toString: '$userId' }, name: '$guestName' },
                  provider: {
                    id: { $toString: '$hotelId' },
                    name: '$hotelName',
                  },
                  dates: { from: '$checkIn', to: '$checkOut' },
                  amountMinor: '$totalMinor',
                  currency: 1,
                  status: '$effectiveStatus',
                  createdAt: { $ifNull: ['$createdAt', null] },
                },
              },
            ],
            count: [{ $count: 'total' }],
          },
        },
      ])
      .exec();
    const total = result.count[0]?.total ?? 0;
    return {
      data: result.data,
      meta: {
        page: query.page,
        limit: 10,
        total,
        totalPages: Math.ceil(total / 10),
      },
    };
  }
}
