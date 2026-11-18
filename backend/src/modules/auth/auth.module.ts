import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';
import { AuthService } from './auth.service';
import { SessionGuard } from './security/session.guard';
import { RolesGuard } from './security/roles.guard';
import { UserSession, UserSessionSchema } from './schemas/user-session.schema';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  HotelBooking,
  HotelBookingSchema,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import { AccountLifecycleService } from './account-lifecycle.service';

@Module({
  imports: [
    UsersModule,
    MongooseModule.forFeature([
      { name: UserSession.name, schema: UserSessionSchema },
      { name: User.name, schema: UserSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
    ]),
  ],
  controllers: [AuthController, UsersController],
  providers: [AuthService, SessionGuard, RolesGuard, AccountLifecycleService],
  exports: [AuthService, SessionGuard, RolesGuard],
})
export class AuthModule {}
