import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { ModeratorAssignmentsModule } from '../administration/moderator-assignments.module';
import { Flight, FlightSchema } from '../flights/schemas/flight.schema';
import {
  FlightBooking,
  FlightBookingSchema,
} from '../flight-bookings/schemas/flight-booking.schema';
import { DomainEventsModule } from '../domain-events/domain-events.module';
import { Airline, AirlineSchema } from './schemas/airline.schema';
import { AirlinesController } from './airlines.controller';
import { AirlinesService } from './airlines.service';
import { MediaUploadsModule } from '../media-uploads/media-uploads.module';

@Module({
  imports: [
    AuthModule,
    ModeratorAssignmentsModule,
    DomainEventsModule,
    MediaUploadsModule,
    MongooseModule.forFeature([
      { name: Airline.name, schema: AirlineSchema },
      { name: Flight.name, schema: FlightSchema },
      { name: FlightBooking.name, schema: FlightBookingSchema },
    ]),
  ],
  controllers: [AirlinesController],
  providers: [AirlinesService],
  exports: [AirlinesService],
})
export class AirlinesModule {}
