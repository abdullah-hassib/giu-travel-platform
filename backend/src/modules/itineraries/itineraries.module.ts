import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { HotelsModule } from '../hotels/hotels.module';
import {
  ItineraryHotelsController,
  ItineraryHotelsService,
} from './itinerary-hotels.controller';
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
    HotelsModule,
    MongooseModule.forFeature([
      { name: Itinerary.name, schema: ItinerarySchema },
      { name: User.name, schema: UserSchema },
    ]),
  ],
  controllers: [
    ItinerariesController,
    ItineraryActivitiesController,
    PublicItinerariesController,
    ItineraryHotelsController,
  ],
  providers: [ItinerariesService, ItineraryHotelsService],
  exports: [ItinerariesService],
})
export class ItinerariesModule {}
