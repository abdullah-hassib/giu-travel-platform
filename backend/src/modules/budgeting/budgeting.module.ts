import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { BudgetingController } from './budgeting.controller';
import { FxRatesClient } from './fx-rates.client';
import { FxRatesService } from './fx-rates.service';
import { FxRateCache, FxRateCacheSchema } from './schemas/fx-rate-cache.schema';

@Module({
  imports: [
    AuthModule,
    ItinerariesModule,
    MongooseModule.forFeature([
      { name: FxRateCache.name, schema: FxRateCacheSchema },
    ]),
  ],
  controllers: [BudgetingController],
  providers: [FxRatesClient, FxRatesService],
})
export class BudgetingModule {}
