import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import {
  OutboxEvent,
  OutboxEventSchema,
} from '../../common/events/outbox-event.schema';
import { AuthModule } from '../auth/auth.module';
import { BlogModule } from '../blog/blog.module';
import {
  Itinerary,
  ItinerarySchema,
} from '../itineraries/schemas/itinerary.schema';
import { ReviewsModule } from '../reviews/reviews.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { ModerationController, ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import {
  ContentReport,
  ContentReportSchema,
} from './schemas/content-report.schema';

/** Content reports and admin moderation (GEN-09, GEN-10). */
@Module({
  imports: [
    AuthModule,
    BlogModule,
    ReviewsModule,
    MongooseModule.forFeature([
      { name: ContentReport.name, schema: ContentReportSchema },
      { name: OutboxEvent.name, schema: OutboxEventSchema },
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [ReportsController, ModerationController],
  providers: [ReportsService],
})
export class CommunityModule {}
