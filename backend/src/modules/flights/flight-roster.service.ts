import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, PipelineStage, Types } from 'mongoose';
import { AirlinesService } from '../airlines/airlines.service';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import { FlightBooking } from '../flight-bookings/schemas/flight-booking.schema';
import { Flight } from './schemas/flight.schema';
import {
  FlightRosterBookingDto,
  FlightRosterResponseDto,
} from './dto/flight-roster.dto';

/** RFC 4180 quoting plus spreadsheet formula protection, preserving Unicode text. */
function csvCell(value: string): string {
  const safe =
    /^\s*[=+\-@]/u.test(value) || /^[\t\r\n]/u.test(value)
      ? "'" + value
      : value;
  return '"' + safe.replace(/"/g, '""') + '"';
}

@Injectable()
export class FlightRosterService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(FlightBooking.name)
    private readonly bookings: Model<FlightBooking>,
    private readonly ownership: AirlinesService,
    private readonly holds: FlightBookingsService,
  ) {}

  private async authorized(userId: string, id: string) {
    const flight = await this.flights.findById(id).lean();
    if (!flight) throw new NotFoundException('Flight not found');
    await this.ownership.assertAssigned(userId, flight.airlineId.toString());
    await this.holds.expireDue();
    const current = await this.flights.findById(id).lean();
    if (!current) throw new NotFoundException('Flight not found');
    return current;
  }

  private rows(id: string): PipelineStage[] {
    return [
      {
        $match: {
          'segments.flightId': new Types.ObjectId(id),
          status: { $in: ['Confirmed', 'Cancelled', 'Completed'] },
        },
      },
      { $sort: { createdAt: -1, _id: -1 } },
      {
        $set: {
          segment: {
            $arrayElemAt: [
              {
                $filter: {
                  input: '$segments',
                  as: 'segment',
                  cond: { $eq: ['$$segment.flightId', new Types.ObjectId(id)] },
                },
              },
              0,
            ],
          },
        },
      },
      {
        $project: {
          _id: 0,
          bookingId: { $toString: '$_id' },
          reference: '$bookingReference',
          passengerNames: '$passengers.fullName',
          cabinCategory: '$segment.cabinCategory',
          seatsReserved: '$segment.seatsReserved',
          status: {
            $cond: [
              { $eq: ['$status', 'Cancelled'] },
              'Cancelled',
              'Confirmed',
            ],
          },
        },
      },
    ];
  }

  async list(
    userId: string,
    id: string,
    page: number,
  ): Promise<FlightRosterResponseDto> {
    const flight = await this.authorized(userId, id);
    const [result] = await this.bookings
      .aggregate<{
        data: FlightRosterBookingDto[];
        count: { total: number }[];
      }>([
        ...this.rows(id),
        {
          $facet: {
            data: [{ $skip: (page - 1) * 10 }, { $limit: 10 }],
            count: [{ $count: 'total' }],
          },
        },
      ])
      .exec();
    const total = result.count[0]?.total ?? 0;
    return {
      flight: {
        id,
        flightNumber: flight.flightNumber,
        status:
          flight.status === 'Scheduled' && flight.departureAt <= new Date()
            ? 'Departed'
            : flight.status,
        departureAt: flight.departureAt.toISOString(),
        arrivalAt: flight.arrivalAt.toISOString(),
        cabins: flight.cabins.map((cabin) => ({
          category: cabin.category,
          totalSeats: cabin.totalSeats,
          bookedSeats: cabin.bookedSeats,
          heldSeats: cabin.heldSeats,
          availableSeats: Math.max(
            0,
            cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats,
          ),
        })),
      },
      data: result.data,
      meta: { page, limit: 10, total, totalPages: Math.ceil(total / 10) },
    };
  }

  async exportCsv(userId: string, id: string): Promise<Buffer> {
    await this.authorized(userId, id);
    const rows = await this.bookings
      .aggregate<FlightRosterBookingDto>(this.rows(id))
      .exec();
    const lines = [
      ['bookingReference', 'passengerName', 'cabinCategory', 'status']
        .map(csvCell)
        .join(','),
    ];
    for (const row of rows)
      for (const name of row.passengerNames)
        lines.push(
          [row.reference, name, row.cabinCategory, row.status]
            .map(csvCell)
            .join(','),
        );
    return Buffer.from('\uFEFF' + lines.join('\r\n') + '\r\n', 'utf8');
  }
}
