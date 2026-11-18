import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CURRENCIES } from '../../reference-data/official-reference';
import { SummaryCategory } from '../budgeting.constants';
import { NativeBudgetSummaryDto } from './budget-summary.dto';

export class ConvertedDayBudgetDto {
  @ApiProperty() dayId!: string;
  @ApiProperty() dayNumber!: number;
  @ApiProperty() date!: string;
  @ApiProperty({ type: 'integer' }) totalMinor!: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'integer' } })
  byCategory!: Record<SummaryCategory, number>;
}

export class ConvertedBudgetSummaryDto {
  @ApiProperty({ enum: CURRENCIES }) currency!: string;
  @ApiProperty({ type: 'integer' }) totalMinor!: number;
  @ApiProperty({ type: 'object', additionalProperties: { type: 'integer' } })
  byCategory!: Record<SummaryCategory, number>;
  @ApiProperty({ type: [ConvertedDayBudgetDto] })
  byDay!: ConvertedDayBudgetDto[];
  @ApiProperty({ format: 'date' }) rateDate!: string;
  @ApiProperty({ format: 'date-time' }) fetchedAt!: string;
  @ApiProperty({
    description:
      'Last successful cache used after today’s fetch failed or did not finish',
  })
  fallback!: boolean;
  @ApiProperty({ description: 'The rate date precedes the current UTC date' })
  stale!: boolean;
  @ApiProperty({ enum: ['FXRatesAPI'] }) source!: string;
}

export class BudgetSummaryDto extends NativeBudgetSummaryDto {
  @ApiPropertyOptional({
    type: ConvertedBudgetSummaryDto,
    description:
      'Included when the owner has selected a preferred currency in their profile',
  })
  converted?: ConvertedBudgetSummaryDto;
}
