import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage } from 'mongoose';
import { DELETED_USER } from '../../common/mongo-helpers';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { todayUtc } from '../hotels/stay-rules';
import { User } from '../users/schemas/user.schema';
import {
  AdminBookingsPageDto,
  AdminBookingsQueryDto,
  AdminBookingViewDto,
} from './dto/admin-bookings.dto';
type BookingReadStage =
  PipelineStage.Set | PipelineStage.Project | PipelineStage.Lookup;

/** Positive projections from the actual schemas; this read never advances lifecycle state. */
@Injectable()
export class AdminBookingsService {
  constructor(
    @InjectModel(HotelBooking.name)
    private readonly hotels: Model<HotelBooking>,
    @InjectModel(FlightBooking.name)
    private readonly flights: Model<FlightBooking>,
    @InjectModel(User.name) private readonly users: Model<User>,
  ) {}

  async list(query: AdminBookingsQueryDto): Promise<AdminBookingsPageDto> {
    if (query.from && query.to && query.from > query.to)
      throw new BadRequestException('from cannot be after to');
    const now = new Date();
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.from || query.to)
      filter['dates.from'] = {
        ...(query.from && { $gte: query.from }),
        ...(query.to && { $lte: query.to }),
      };
    const pipeline: PipelineStage[] =
      query.type === 'flight' ? this.flightRows(now) : this.hotelRows(now);
    if (!query.type)
      pipeline.push({
        $unionWith: {
          coll: this.flights.collection.name,
          pipeline: this.flightRows(now),
        },
      });
    pipeline.push(
      { $match: filter },
      {
        $facet: {
          data: [
            { $sort: { createdAt: -1, type: 1, id: -1 } },
            { $skip: (query.page - 1) * 10 },
            { $limit: 10 },
          ],
          count: [{ $count: 'total' }],
        },
      },
    );
    const source = query.type === 'flight' ? this.flights : this.hotels;
    const [result] = await source
      .aggregate<{ data: AdminBookingViewDto[]; count: { total: number }[] }>(
        pipeline,
      )
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

  private hotelRows(now: Date): BookingReadStage[] {
    return [
      {
        $set: {
          effectiveStatus: {
            $switch: {
              branches: [
                {
                  case: {
                    $and: [
                      { $eq: ['$status', 'Pending Payment'] },
                      { $lte: ['$holdExpiresAt', now] },
                    ],
                  },
                  then: 'Expired',
                },
                {
                  case: {
                    $and: [
                      { $eq: ['$status', 'Confirmed'] },
                      { $lt: ['$checkOut', todayUtc(now)] },
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
      {
        $project: {
          _id: 0,
          id: { $toString: '$_id' },
          type: { $literal: 'hotel' },
          reference: { $ifNull: ['$reference', null] },
          user: { id: { $toString: '$userId' }, name: '$guestName' },
          provider: { id: { $toString: '$hotelId' }, name: '$hotelName' },
          dates: { from: '$checkIn', to: '$checkOut' },
          amountMinor: '$totalMinor',
          currency: 1,
          status: '$effectiveStatus',
          createdAt: { $ifNull: ['$createdAt', null] },
        },
      },
    ];
  }

  private flightRows(now: Date): BookingReadStage[] {
    return [
      {
        $set: {
          outbound: { $arrayElemAt: ['$segments', 0] },
          finalSegment: { $arrayElemAt: ['$segments', -1] },
        },
      },
      {
        $set: {
          effectiveStatus: {
            $switch: {
              branches: [
                {
                  case: {
                    $and: [
                      { $eq: ['$status', 'Pending Payment'] },
                      {
                        $or: [
                          { $lte: ['$holdExpiresAt', now] },
                          { $lte: ['$outbound.departureAt', now] },
                        ],
                      },
                    ],
                  },
                  then: 'Expired',
                },
                {
                  case: {
                    $and: [
                      { $eq: ['$status', 'Confirmed'] },
                      { $lte: ['$finalSegment.arrivalAt', now] },
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
      // Only the required display field leaves the lookup; no credential/contact fields.
      {
        $lookup: {
          from: this.users.collection.name,
          localField: 'userId',
          foreignField: '_id',
          pipeline: [{ $project: { _id: 0, fullName: 1 } }],
          as: 'owner',
        },
      },
      {
        $project: {
          _id: 0,
          id: { $toString: '$_id' },
          type: { $literal: 'flight' },
          reference: {
            $cond: [
              { $in: ['$effectiveStatus', ['Pending Payment', 'Expired']] },
              null,
              '$bookingReference',
            ],
          },
          user: {
            id: { $toString: '$userId' },
            name: {
              $ifNull: [{ $arrayElemAt: ['$owner.fullName', 0] }, DELETED_USER],
            },
          },
          provider: {
            id: { $toString: '$outbound.airlineId' },
            name: '$outbound.airlineName',
          },
          dates: {
            from: '$outbound.departureLocalDate',
            to: {
              $dateToString: {
                date: '$finalSegment.arrivalAt',
                format: '%Y-%m-%d',
                timezone: 'UTC',
              },
            },
          },
          amountMinor: '$totalAmountMinor',
          currency: 1,
          status: '$effectiveStatus',
          createdAt: { $ifNull: ['$createdAt', null] },
        },
      },
    ];
  }
}
