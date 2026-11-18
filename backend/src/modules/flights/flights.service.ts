import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';

import { Airline } from '../airlines/schemas/airline.schema';
import { ReferenceDataService } from '../reference-data/reference-data.service';
import { AirlinesService } from '../airlines/airlines.service';
import { DomainEventPublisherService } from '../domain-events/domain-event-publisher.service';
import { publishEffects } from '../domain-events/publish-effects';
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

    private readonly reference: ReferenceDataService,
    private readonly ownership: AirlinesService,
    @InjectConnection() private readonly connection: Connection,
    private readonly events: DomainEventPublisherService,
  ) {}

  async createForModerator(
    moderatorId: string,
    dto: CreateFlightDto,
  ): Promise<Flight> {
    const airlineId = await this.ownership.assertAssigned(moderatorId);
    const airline = await this.airlines.findById(airlineId).exec();

    if (!airline) {
      throw new ForbiddenException('You are not assigned to an airline');
    }

    if (airline.status !== 'active') {
      throw new ForbiddenException('Your airline is not active');
    }

    if (
      dto.departureAirportCode.toUpperCase() ===
      dto.arrivalAirportCode.toUpperCase()
    ) {
      throw new BadRequestException(
        'Departure and arrival airports must be different',
      );
    }

    const [departureAirport, arrivalAirport] = await Promise.all([
      this.reference.getAirport(dto.departureAirportCode),
      this.reference.getAirport(dto.arrivalAirportCode),
    ]);

    if (!departureAirport || !arrivalAirport) {
      throw new BadRequestException(
        'Departure or arrival airport is not in the official airport list',
      );
    }

    const departureAt = airportLocalTimeToUtc(
      dto.departureLocalDateTime,
      departureAirport.time_zone,
    );

    const arrivalAt = airportLocalTimeToUtc(
      dto.arrivalLocalDateTime,
      arrivalAirport.time_zone,
    );

    const now = new Date();

    if (departureAt <= now) {
      throw new BadRequestException('Departure time must be in the future');
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

    const departureLocalDate = dto.departureLocalDateTime.split('T')[0];

    try {
      return await this.connection.transaction(async (session) => {
        const active = await this.airlines.findOneAndUpdate(
          { _id: airlineId, status: 'active' },
          { $inc: { inventoryVersion: 1 } },
          { session },
        );
        if (!active) throw new ForbiddenException('Your airline is not active');
        const [flight] = await this.flights.create(
          [
            {
              airlineId: airline._id,
              flightNumber: dto.flightNumber.trim().toUpperCase(),
              departureAirportId: departureAirport.iata_code,
              arrivalAirportId: arrivalAirport.iata_code,
              departureAt,
              arrivalAt,
              departureLocalDate,
              status: 'Scheduled',
              cabins: dto.cabins.map((cabin) => ({
                ...cabin,
                bookedSeats: 0,
                heldSeats: 0,
              })),
            },
          ],
          { session },
        );
        await publishEffects(
          this.events,
          session,
          'flight.created',
          moderatorId,
          {
            action: 'flight.created',
            resourceType: 'flight',
            resourceId: flight._id.toString(),
            outcome: 'success',
          },
        );
        return flight;
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
