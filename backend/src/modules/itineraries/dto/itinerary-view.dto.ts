import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ActivityCostDto } from './itinerary.dto';
import {
  BudgetEntryViewDto,
  TransportEntryViewDto,
} from '../../budgeting/dto/budget.dto';
import { NativeBudgetSummaryDto } from '../../budgeting/dto/budget-summary.dto';

export class ActivityViewDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() description!: string;
  @ApiPropertyOptional() time?: string;
  @ApiPropertyOptional({ type: ActivityCostDto }) cost?: ActivityCostDto;
}

export class DayViewDto {
  @ApiProperty({ type: [BudgetEntryViewDto] }) budgets!: BudgetEntryViewDto[];
  @ApiProperty({ type: [TransportEntryViewDto] })
  transportCosts!: TransportEntryViewDto[];
  @ApiProperty() id!: string;
  @ApiProperty() dayNumber!: number;
  @ApiProperty({ example: '2026-11-20' }) date!: string;
  @ApiProperty() cityId!: string;
  @ApiProperty() cityName!: string;
  @ApiProperty() notes!: string;
  @ApiProperty({ type: [ActivityViewDto] }) activities!: ActivityViewDto[];
}

export class CityGroupDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer' },
    description:
      'All budget/activity/intercity costs by original currency, in minor units',
  })
  budgetTotals!: Record<string, number>;
  @ApiProperty() cityId!: string;
  @ApiProperty() cityName!: string;
  @ApiProperty() firstDayNumber!: number;
  @ApiProperty() dayCount!: number;
  @ApiProperty() startDate!: string;
  @ApiProperty() endDate!: string;
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer' },
    description:
      'Activity-only subtotals by original currency, in minor units; FX/budget entries are a later slice',
  })
  activityTotals!: Record<string, number>;
}

export class ItineraryAuthorDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
}

export class CloneAttributionDto {
  @ApiProperty() itineraryId!: string;
  @ApiProperty() authorId!: string;
  @ApiProperty() authorName!: string;
}

export class ItineraryViewDto {
  @ApiProperty({ type: NativeBudgetSummaryDto })
  budgetSummary!: NativeBudgetSummaryDto;
  @ApiProperty() id!: string;
  @ApiProperty() ownerId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: [String] }) countryCodes!: string[];
  @ApiProperty() startDate!: string;
  @ApiProperty({ enum: ['private', 'public'] }) visibility!:
    'private' | 'public';
  @ApiProperty() revision!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;
  @ApiProperty({ type: [DayViewDto] }) days!: DayViewDto[];
  @ApiProperty({ type: [CityGroupDto] }) cityGroups!: CityGroupDto[];
  @ApiPropertyOptional({ type: ItineraryAuthorDto })
  author?: ItineraryAuthorDto;
  @ApiPropertyOptional({ type: CloneAttributionDto })
  clonedFrom?: CloneAttributionDto;
}

class ItineraryPageMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty({ enum: [10] }) limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}

export class ItineraryListViewDto {
  @ApiProperty({ type: [ItineraryViewDto] }) data!: ItineraryViewDto[];
  @ApiProperty({ type: ItineraryPageMetaDto }) meta!: ItineraryPageMetaDto;
}
