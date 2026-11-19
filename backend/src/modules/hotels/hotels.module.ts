import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  OutboxEvent,
  OutboxEventSchema,
} from '../../common/events/outbox-event.schema';
import { AuthModule } from '../auth/auth.module';
import {
  HotelBooking,
  HotelBookingSchema,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import { MediaUploadsModule } from '../media-uploads/media-uploads.module';
import { HotelRoomsController, HotelsController } from './hotels.controller';
import { HotelsService } from './hotels.service';
import { RoomsService } from './rooms.service';
import { Hotel, HotelSchema } from './schemas/hotel.schema';
import { HotelRoom, HotelRoomSchema } from './schemas/room.schema';
import { DomainEventsModule } from '../domain-events/domain-events.module';

/** Hotels, their rooms, availability and policies (HTL-01..HTL-15, HTL-22). */
@Module({
  imports: [
    AuthModule,
    MediaUploadsModule,
    DomainEventsModule,
    MongooseModule.forFeature([
      { name: Hotel.name, schema: HotelSchema },
      { name: HotelRoom.name, schema: HotelRoomSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: OutboxEvent.name, schema: OutboxEventSchema },
    ]),
  ],
  controllers: [HotelsController, HotelRoomsController],
  providers: [HotelsService, RoomsService],
  exports: [HotelsService],
})
export class HotelsModule {}
