import { ApiProperty, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsMongoId, IsString, MinLength } from 'class-validator';
import { ActivityCostDto } from '../../itineraries/dto/itinerary.dto';
import { CITY_IDS } from '../../itineraries/reference-data';
import { BUDGET_CATEGORIES, BudgetCategory } from '../budgeting.constants';

export class CreateBudgetDto extends ActivityCostDto {
  @ApiProperty({ enum: BUDGET_CATEGORIES })
  @IsIn(BUDGET_CATEGORIES)
  category!: BudgetCategory;
}

export class UpdateBudgetDto extends PartialType(CreateBudgetDto, {
  skipNullProperties: false,
}) {}

export class CreateTransportDto extends ActivityCostDto {
  @ApiProperty({ description: 'Official city identifier' })
  @IsIn(CITY_IDS)
  fromCityId!: string;

  @ApiProperty({ description: 'Official city identifier' })
  @IsIn(CITY_IDS)
  toCityId!: string;

  @ApiProperty({ example: 'train' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1)
  mode!: string;

  @ApiProperty({ description: 'Existing day ID within the owner itinerary' })
  @IsMongoId()
  dayId!: string;
}

export class UpdateTransportDto extends PartialType(CreateTransportDto, {
  skipNullProperties: false,
}) {}

export class BudgetEntryViewDto extends CreateBudgetDto {
  @ApiProperty() id!: string;
}

export class TransportEntryViewDto extends CreateTransportDto {
  @ApiProperty() id!: string;
}

/** Original-currency summary currently accepts no conversion query fields. */
export class NativeBudgetSummaryQueryDto {}
