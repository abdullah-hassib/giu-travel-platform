import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { REFERENCE_MODELS } from './reference.schema';
import { ReferenceDataService } from './reference-data.service';
import { ReferenceDataController } from './reference-data.controller';
@Module({
  imports: [MongooseModule.forFeature(REFERENCE_MODELS)],
  providers: [ReferenceDataService],
  controllers: [ReferenceDataController],
  exports: [ReferenceDataService],
})
export class ReferenceDataModule {}
