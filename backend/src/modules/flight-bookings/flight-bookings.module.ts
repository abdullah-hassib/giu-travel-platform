import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';

import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';

import { Flight, FlightSchema } from '../flights/schemas/flight.schema';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { Airport, AirportSchema } from '../reference-data/schemas/airport.schema';

import { FlightBookingsService } from './flight-bookings.service';
import { FlightBookingsController } from './flight-bookings.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      {
        name: FlightBooking.name,
        schema: FlightBookingSchema,
      },
      {
        name: Flight.name,
        schema: FlightSchema,
      },
      {
        name: Airline.name,
        schema: AirlineSchema,
      },
      {
        name: Airport.name,
        schema: AirportSchema,
      },
    ]),
  ],
  controllers: [FlightBookingsController],
  providers: [FlightBookingsService],
  exports: [MongooseModule, FlightBookingsService],
})
export class FlightBookingsModule {}
