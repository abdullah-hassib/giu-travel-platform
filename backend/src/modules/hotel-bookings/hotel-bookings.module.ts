import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  OutboxEvent,
  OutboxEventSchema,
} from '../../common/events/outbox-event.schema';
import { AuthModule } from '../auth/auth.module';
import { HotelsModule } from '../hotels/hotels.module';
import { RefundsModule } from '../refunds/refunds.module';
import { Hotel, HotelSchema } from '../hotels/schemas/hotel.schema';
import { HotelRoom, HotelRoomSchema } from '../hotels/schemas/room.schema';
import { HotelBookingsController } from './hotel-bookings.controller';
import { HotelBookingsService } from './hotel-bookings.service';
import { HotelPaymentAdapter } from './hotel-payment.adapter';
import {
  HotelBooking,
  HotelBookingSchema,
} from './schemas/hotel-booking.schema';

/** Hotel reservations: holds, history, cancellation and payment settlement (HTL-16..HTL-21). */
@Module({
  imports: [
    AuthModule,
    HotelsModule,
    RefundsModule,
    MongooseModule.forFeature([
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: Hotel.name, schema: HotelSchema },
      { name: HotelRoom.name, schema: HotelRoomSchema },
      { name: OutboxEvent.name, schema: OutboxEventSchema },
    ]),
  ],
  controllers: [HotelBookingsController],
  providers: [HotelBookingsService, HotelPaymentAdapter],
  exports: [HotelPaymentAdapter],
})
export class HotelBookingsModule {}
