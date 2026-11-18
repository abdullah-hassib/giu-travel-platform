import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';

import { Airline } from '../airlines/schemas/airline.schema';
import { Airport } from '../reference-data/schemas/airport.schema';
import { CreateFlightDto } from './dto/create-flight.dto';
import { Flight } from './schemas/flight.schema';
import { airportLocalTimeToUtc } from '../../common/utils/airport-timezone.util';

@Injectable()
export class FlightsService {
  constructor(
    @InjectModel(Flight.name)
    private readonly flights: Model<Flight>,

    @InjectModel(Airline.name)
    private readonly airlines: Model<Airline>,

    @InjectModel(Airport.name)
    private readonly airports: Model<Airport>,
  ) {}

  async createForModerator(
    moderatorId: string,
    dto: CreateFlightDto,
  ): Promise<Flight> {
    const airline = await this.airlines.findOne({
      moderatorId,
    }).exec();

    if (!airline) {
      throw new ForbiddenException(
        'You are not assigned to an airline',
      );
    }

    if (airline.status !== 'active') {
      throw new ForbiddenException(
        'Your airline is not active',
      );
    }

    if (dto.departureAirportCode.toUpperCase() ===
        dto.arrivalAirportCode.toUpperCase()) {
      throw new BadRequestException(
        'Departure and arrival airports must be different',
      );
    }

    const [departureAirport, arrivalAirport] = await Promise.all([
      this.airports.findOne({
        iataCode: dto.departureAirportCode.toUpperCase(),
      }).exec(),
      this.airports.findOne({
        iataCode: dto.arrivalAirportCode.toUpperCase(),
      }).exec(),
    ]);

    if (!departureAirport || !arrivalAirport) {
      throw new BadRequestException(
        'Departure or arrival airport is not in the official airport list',
      );
    }

    const departureAt = airportLocalTimeToUtc(
      dto.departureLocalDateTime,
      departureAirport.timeZone,
    );

    const arrivalAt = airportLocalTimeToUtc(
      dto.arrivalLocalDateTime,
      arrivalAirport.timeZone,
    );

    const now = new Date();

    if (departureAt <= now) {
      throw new BadRequestException(
        'Departure time must be in the future',
      );
    }

    if (arrivalAt <= departureAt) {
      throw new BadRequestException(
        'Arrival time must be after departure time',
      );
    }

    const categories = dto.cabins.map((cabin) => cabin.category);

    if (new Set(categories).size !== categories.length) {
      throw new BadRequestException(
        'Each cabin category can appear only once per flight',
      );
    }

    const departureLocalDate =
      dto.departureLocalDateTime.split('T')[0];

    try {
      return await this.flights.create({
        airlineId: airline._id,
        flightNumber: dto.flightNumber.trim().toUpperCase(),
        departureAirportId: departureAirport._id,
        arrivalAirportId: arrivalAirport._id,
        departureAt,
        arrivalAt,
        departureLocalDate,
        status: 'Scheduled',
        cabins: dto.cabins.map((cabin) => ({
          ...cabin,
          bookedSeats: 0,
          heldSeats: 0,
        })),
      });
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      ) {
        throw new ConflictException(
          'A flight with this number already exists for this airline on this departure date',
        );
      }

      throw error;
    }
  }
}
