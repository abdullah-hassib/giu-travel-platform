import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { ModeratorAssignmentsModule } from '../administration/moderator-assignments.module';
import { AirlinesModule } from '../airlines/airlines.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';

import { Flight, FlightSchema } from './schemas/flight.schema';
import { FlightsController } from './flights.controller';
import { FlightsService } from './flights.service';
import { FlightSearchService } from './flight-search.service';
import { FlightBookingsModule } from '../flight-bookings/flight-bookings.module';
import { FlightOperationsService } from './flight-operations.service';
import { FlightOperationsController } from './flight-operations.controller';
import { RefundsModule } from '../refunds/refunds.module';
import {
  FlightBooking,
  FlightBookingSchema,
} from '../flight-bookings/schemas/flight-booking.schema';

@Module({
  imports: [
    AuthModule,
    ReferenceDataModule,
    ModeratorAssignmentsModule,
    AirlinesModule,
    DomainEventsModule,
    FlightBookingsModule,
    RefundsModule,
    MongooseModule.forFeature([
      { name: Flight.name, schema: FlightSchema },
      { name: Airline.name, schema: AirlineSchema },
      { name: FlightBooking.name, schema: FlightBookingSchema },
    ]),
  ],
  controllers: [FlightsController, FlightOperationsController],
  providers: [FlightsService, FlightSearchService, FlightOperationsService],
  exports: [FlightsService, FlightSearchService],
})
export class FlightsModule {}
