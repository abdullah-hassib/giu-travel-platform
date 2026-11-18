import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { environmentSchema } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { AdministrationModule } from './modules/administration/administration.module';
import { AirlinesModule } from './modules/airlines/airlines.module';
import { FlightsModule } from './modules/flights/flights.module';
import { FlightBookingsModule } from './modules/flight-bookings/flight-bookings.module';
import { HotelsModule } from './modules/hotels/hotels.module';
import { HotelBookingsModule } from './modules/hotel-bookings/hotel-bookings.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { RefundsModule } from './modules/refunds/refunds.module';
import { ItinerariesModule } from './modules/itineraries/itineraries.module';
import { BudgetingModule } from './modules/budgeting/budgeting.module';
import { BlogModule } from './modules/blog/blog.module';
import { CommunityModule } from './modules/community/community.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { MediaUploadsModule } from './modules/media-uploads/media-uploads.module';
import { AuditLoggingModule } from './modules/audit-logging/audit-logging.module';
import { ReferenceDataModule } from './modules/reference-data/reference-data.module';
import { DomainEventsModule } from './modules/domain-events/domain-events.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env', validationSchema: environmentSchema, validationOptions: { abortEarly: false } }),
    MongooseModule.forRootAsync({ inject: [ConfigService], useFactory: (config: ConfigService) => ({ uri: config.getOrThrow<string>('MONGODB_URI'), serverSelectionTimeoutMS: 5000, maxPoolSize: 10 }) }),
    HealthModule, AuthModule, UsersModule, AdministrationModule, AirlinesModule, FlightsModule,
    FlightBookingsModule, HotelsModule, HotelBookingsModule, ReviewsModule,
    PaymentsModule, RefundsModule, ItinerariesModule, BudgetingModule, BlogModule,
    CommunityModule, NotificationsModule, MediaUploadsModule, AuditLoggingModule, ReferenceDataModule, DomainEventsModule,
  ],
})
export class AppModule {}
