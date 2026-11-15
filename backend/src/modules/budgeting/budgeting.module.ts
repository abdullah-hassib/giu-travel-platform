import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ItinerariesModule } from '../itineraries/itineraries.module';
import { BudgetingController } from './budgeting.controller';

@Module({
  imports: [AuthModule, ItinerariesModule],
  controllers: [BudgetingController],
})
export class BudgetingModule {}
