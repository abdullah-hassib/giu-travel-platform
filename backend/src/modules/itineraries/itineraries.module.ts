import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { Itinerary, ItinerarySchema } from './schemas/itinerary.schema';
import { ItinerariesService } from './itineraries.service';
import {
  ItinerariesController,
  ItineraryActivitiesController,
  PublicItinerariesController,
} from './itineraries.controller';

@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [
    ItinerariesController,
    ItineraryActivitiesController,
    PublicItinerariesController,
  ],
  providers: [ItinerariesService],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
