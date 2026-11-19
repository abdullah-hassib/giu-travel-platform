import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { AuthModule } from '../auth/auth.module';

import {
  FlightBooking,
  FlightBookingSchema,
} from './schemas/flight-booking.schema';

import { Flight, FlightSchema } from '../flights/schemas/flight.schema';
import { Airline, AirlineSchema } from '../airlines/schemas/airline.schema';
import { ReferenceDataModule } from '../reference-data/reference-data.module';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { RefundsModule } from '../refunds/refunds.module';
import { FlightPaymentAdapter } from './flight-payment.adapter';

import { FlightBookingsService } from './flight-bookings.service';
import { FlightBookingsController } from './flight-bookings.controller';
import { FlightEticketController } from './flight-eticket.controller';
import { FlightEticketService } from './flight-eticket.service';

@Module({
  imports: [
    AuthModule,
    ReferenceDataModule,
    DomainEventsModule,
    RefundsModule,
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
    ]),
  ],
  controllers: [FlightBookingsController, FlightEticketController],
  providers: [
    FlightBookingsService,
    FlightPaymentAdapter,
    FlightEticketService,
  ],
  exports: [MongooseModule, FlightBookingsService, FlightPaymentAdapter],
})
export class FlightBookingsModule {}
