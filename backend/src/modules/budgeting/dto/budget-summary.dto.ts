import { ApiProperty } from '@nestjs/swagger';
import { SummaryCategory } from '../budgeting.constants';

export type CurrencyTotals = Record<string, number>;
export type CategoryTotals = Record<SummaryCategory, CurrencyTotals>;

export class NativeBudgetBucketDto {
  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'integer' },
    description:
      'Original currency to integer minor-unit total; no FX conversion',
  })
  totalByCurrency!: CurrencyTotals;

  @ApiProperty({
    type: 'object',
    additionalProperties: {
      type: 'object',
      additionalProperties: { type: 'integer' },
    },
    description:
      'Food, accommodation, in-city transport, activities and intercity transport',
  })
  byCategory!: CategoryTotals;
}

export class DayBudgetSummaryDto extends NativeBudgetBucketDto {
  @ApiProperty() dayId!: string;
  @ApiProperty() dayNumber!: number;
  @ApiProperty() date!: string;
}

export class NativeBudgetSummaryDto extends NativeBudgetBucketDto {
  @ApiProperty({ type: [DayBudgetSummaryDto] })
  byDay!: DayBudgetSummaryDto[];
}
