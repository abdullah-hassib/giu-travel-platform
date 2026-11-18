import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  UserSession,
  UserSessionSchema,
} from '../auth/schemas/user-session.schema';
import { HotelsModule } from '../hotels/hotels.module';
import { HotelsService } from '../hotels/hotels.service';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdministrationController } from './administration.controller';
import { ProviderActionsController } from './provider-actions.controller';
import { AdminBookingsController } from './admin-bookings.controller';
import { HotelAdminBookingsService } from './hotel-admin-bookings.service';
import { AdminHistoryController } from './admin-history.controller';
import { AdminHistoryService } from './admin-history.service';
import {
  OutboxEvent,
  OutboxEventSchema,
} from '../../common/events/outbox-event.schema';
import {
  HotelBooking,
  HotelBookingSchema,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import { AdministrationService } from './administration.service';
import {
  AdminOutboxEvent,
  AdminOutboxEventSchema,
} from './schemas/admin-outbox.schema';
import { ModeratorAssignmentsModule } from './moderator-assignments.module';
import { ModeratorProvisioningService } from './moderator-provisioning.service';
import {
  ADMINISTRATION_PROVIDER_ADAPTERS,
  AdministrationProviderAdapters,
} from './provider-administration.adapter';

@Module({
  imports: [
    AuthModule,
    ModeratorAssignmentsModule,
    HotelsModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: UserSession.name, schema: UserSessionSchema },
      { name: AdminOutboxEvent.name, schema: AdminOutboxEventSchema },
      { name: OutboxEvent.name, schema: OutboxEventSchema },
    ]),
  ],
  controllers: [
    AdministrationController,
    ProviderActionsController,
    AdminBookingsController,
    AdminHistoryController,
  ],
  providers: [
    AdministrationService,
    HotelAdminBookingsService,
    AdminHistoryService,
    ModeratorProvisioningService,
    AdministrationProviderAdapters,
    {
      provide: ADMINISTRATION_PROVIDER_ADAPTERS,
      useFactory: (hotels: HotelsService) => [
        {
          kind: 'hotel' as const,
          lockExisting: hotels.lockExisting.bind(hotels),
        },
      ],
      inject: [HotelsService],
    },
  ],
})
export class AdministrationModule {}
