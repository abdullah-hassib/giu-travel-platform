import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { DateTime } from 'luxon';
import { Airline } from '../airlines/schemas/airline.schema';
import { FlightBookingsService } from '../flight-bookings/flight-bookings.service';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { AirportDto } from '../reference-data/reference.dto';
import { CABIN_CATEGORIES, CabinCategory } from './schemas/flight-cabin.schema';
import { Flight } from './schemas/flight.schema';
import { FlightSearchDto } from './dto/flight-search.dto';
import {
  FlightSearchResponseDto,
  PublicFlightDetailsDto,
} from './dto/flight-search-view.dto';

interface CabinOption {
  category: CabinCategory;
  pricePerSeatMinor: number;
  totalAmountMinor: number;
  availableSeats: number;
  freeBags: number;
  maxWeightPerBag: number;
}
interface SearchRow {
  _id: Types.ObjectId;
  flightNumber: string;
  status: Flight['status'];
  departureAirportId: string;
  arrivalAirportId: string;
  departureAt: Date;
  arrivalAt: Date;
  airline: Airline;
  cabins: CabinOption[];
  totalAmountMinor: number;
}

@Injectable()
export class FlightSearchService {
  constructor(
    @InjectModel(Flight.name) private readonly flights: Model<Flight>,
    @InjectModel(Airline.name) private readonly airlines: Model<Airline>,
    private readonly reference: ReferenceDataService,
    private readonly holds: FlightBookingsService,
  ) {}

  async search(
    query: FlightSearchDto,
    destinationCodes?: readonly string[],
  ): Promise<FlightSearchResponseDto> {
    const adults = query.passengers - query.children - query.infants;
    if (!Number.isSafeInteger(adults) || adults < 1 || query.infants > adults)
      throw new BadRequestException(
        'At least one adult is required and infants cannot outnumber adults',
      );
    if (
      query.minPriceMinor !== undefined &&
      query.maxPriceMinor !== undefined &&
      query.minPriceMinor > query.maxPriceMinor
    )
      throw new BadRequestException(
        'Minimum price cannot exceed maximum price',
      );
    if (query.returnDate && query.returnDate < query.departureDate)
      throw new BadRequestException(
        'Return date cannot be before departure date',
      );
    const origin = await this.reference.getAirport(query.departureAirportCode);
    const codes = [...new Set(destinationCodes ?? [query.arrivalAirportCode])];
    if (!destinationCodes && codes.includes(origin.iata_code))
      throw new BadRequestException(
        'Departure and arrival airports must differ',
      );
    const destinations = await Promise.all(
      codes
        .filter((code) => code !== origin.iata_code)
        .map((code) => this.reference.getAirport(code)),
    );
    const today = DateTime.now().setZone(origin.time_zone).toISODate()!;
    if (query.departureDate < today)
      throw new BadRequestException(
        'Departure date cannot be in the past at the departure airport',
      );
    const airports = new Map(
      [origin, ...destinations].map((airport) => [airport.iata_code, airport]),
    );
    const arrivalCodes = destinations
      .map((airport) => airport.iata_code)
      .sort();
    const seats = query.passengers - query.infants;
    await this.holds.expireDue();
    const outbound = await this.leg(
      query,
      [origin.iata_code],
      arrivalCodes,
      query.departureDate,
      query.page,
      adults,
      seats,
      airports,
    );
    const inbound = query.returnDate
      ? await this.leg(
          query,
          arrivalCodes,
          [origin.iata_code],
          query.returnDate,
          query.returnPage,
          adults,
          seats,
          airports,
        )
      : null;
    return {
      criteria: {
        departureAirportCode: origin.iata_code,
        arrivalAirportCodes: arrivalCodes,
        departureDate: query.departureDate,
        returnDate: query.returnDate ?? null,
        passengers: query.passengers,
        adults,
        children: query.children,
        infants: query.infants,
        seatsRequired: seats,
      },
      outbound,
      inbound,
    };
  }

  private async leg(
    query: FlightSearchDto,
    origins: string[],
    destinations: string[],
    date: string,
    page: number,
    adults: number,
    seats: number,
    airports: Map<string, AirportDto>,
  ) {
    const direction = query.order === 'asc' ? 1 : -1;
    const sortKey =
      query.sortBy === 'price'
        ? 'totalAmountMinor'
        : query.sortBy === 'duration'
          ? 'durationMinutes'
          : 'departureAt';
    const [result] = await this.flights
      .aggregate<{ data: SearchRow[]; count: { total: number }[] }>([
        {
          $match: {
            status: 'Scheduled',
            departureAt: { $gt: new Date() },
            departureLocalDate: date,
            departureAirportId: { $in: origins },
            arrivalAirportId: { $in: destinations },
          },
        },
        {
          $lookup: {
            from: this.airlines.collection.name,
            localField: 'airlineId',
            foreignField: '_id',
            as: 'airline',
          },
        },
        { $unwind: '$airline' },
        { $match: { 'airline.status': 'active' } },
        { $unwind: '$cabins' },
        {
          $set: {
            availableSeats: {
              $subtract: [
                '$cabins.totalSeats',
                { $add: ['$cabins.bookedSeats', '$cabins.heldSeats'] },
              ],
            },
            durationMinutes: {
              $divide: [{ $subtract: ['$arrivalAt', '$departureAt'] }, 60_000],
            },
            totalAmountMinor: {
              $add: [
                { $multiply: ['$cabins.price', adults + query.children] },
                // Positive-fare half-up rounding matches passenger pricing, whereas
                // MongoDB $round uses ties-to-even and would underquote some infants.
                {
                  $multiply: [
                    query.infants,
                    {
                      $floor: {
                        $add: [{ $multiply: ['$cabins.price', 0.1] }, 0.5],
                      },
                    },
                  ],
                },
              ],
            },
          },
        },
        {
          $match: {
            availableSeats: { $gte: seats },
            totalAmountMinor: {
              $gte: query.minPriceMinor ?? 1,
              $lte: query.maxPriceMinor ?? Number.MAX_SAFE_INTEGER,
            },
            ...(query.cabinCategory && {
              'cabins.category': query.cabinCategory,
            }),
          },
        },
        {
          $group: {
            _id: '$_id',
            flight: { $first: '$$ROOT' },
            lowestTotal: { $min: '$totalAmountMinor' },
            eligibleCabins: {
              $push: {
                category: '$cabins.category',
                pricePerSeatMinor: '$cabins.price',
                totalAmountMinor: '$totalAmountMinor',
                availableSeats: '$availableSeats',
                freeBags: '$cabins.freeBags',
                maxWeightPerBag: '$cabins.maxWeightPerBag',
              },
            },
          },
        },
        {
          $replaceWith: {
            $mergeObjects: [
              '$flight',
              { cabins: '$eligibleCabins', totalAmountMinor: '$lowestTotal' },
            ],
          },
        },
        {
          $facet: {
            data: [
              { $sort: { [sortKey]: direction, _id: 1 } },
              { $skip: (page - 1) * 10 },
              { $limit: 10 },
            ],
            count: [{ $count: 'total' }],
          },
        },
      ])
      .exec();
    const total = result.count[0]?.total ?? 0;
    return {
      data: result.data.map((row) => this.view(row, airports)),
      meta: { page, limit: 10, total, totalPages: Math.ceil(total / 10) },
    };
  }

  async details(id: string): Promise<PublicFlightDetailsDto> {
    await this.holds.expireDue();
    const flight = await this.flights.findById(id).lean();
    if (!flight) throw new NotFoundException('Flight not found');
    const airline = await this.airlines
      .findOne({ _id: flight.airlineId, status: 'active' })
      .lean();
    if (!airline) throw new NotFoundException('Active airline not found');
    const refs = await Promise.all([
      this.reference.getAirport(flight.departureAirportId),
      this.reference.getAirport(flight.arrivalAirportId),
    ]);
    return this.view(
      {
        ...flight,
        airline,
        cabins: flight.cabins.map((cabin) => ({
          category: cabin.category,
          pricePerSeatMinor: cabin.price,
          totalAmountMinor: cabin.price,
          availableSeats: Math.max(
            0,
            cabin.totalSeats - cabin.bookedSeats - cabin.heldSeats,
          ),
          freeBags: cabin.freeBags,
          maxWeightPerBag: cabin.maxWeightPerBag,
        })),
        totalAmountMinor: Math.min(
          ...flight.cabins.map((cabin) => cabin.price),
        ),
      },
      new Map(refs.map((ref) => [ref.iata_code, ref])),
    );
  }

  private view(
    row: SearchRow,
    airports: Map<string, AirportDto>,
  ): PublicFlightDetailsDto {
    const departure = airports.get(row.departureAirportId)!;
    const arrival = airports.get(row.arrivalAirportId)!;
    return {
      id: row._id.toString(),
      flightNumber: row.flightNumber,
      status:
        row.status === 'Scheduled' && row.departureAt <= new Date()
          ? 'Departed'
          : row.status,
      airline: {
        id: row.airline._id.toString(),
        name: row.airline.name,
        code: row.airline.code,
        logoUrl: row.airline.logoUrl,
      },
      departureAirport: departure,
      arrivalAirport: arrival,
      departureAt: row.departureAt.toISOString(),
      arrivalAt: row.arrivalAt.toISOString(),
      departureLocalDateTime: DateTime.fromJSDate(row.departureAt, {
        zone: departure.time_zone,
      }).toISO({ suppressMilliseconds: true })!,
      arrivalLocalDateTime: DateTime.fromJSDate(row.arrivalAt, {
        zone: arrival.time_zone,
      }).toISO({ suppressMilliseconds: true })!,
      durationMinutes:
        (row.arrivalAt.getTime() - row.departureAt.getTime()) / 60_000,
      cabins: [...row.cabins].sort(
        (a, b) =>
          CABIN_CATEGORIES.indexOf(a.category) -
          CABIN_CATEGORIES.indexOf(b.category),
      ),
      totalAmountMinor: row.totalAmountMinor,
      currency: 'USD',
      extraBagPriceMinor: row.airline.baggagePolicy
        ? Math.round(row.airline.baggagePolicy.extraBagPrice * 100)
        : null,
      maxExtraBags: row.airline.baggagePolicy?.maxExtraBags ?? null,
      cancellationPolicy: row.airline.cancellationPolicy,
    };
  }
}
