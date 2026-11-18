import { ApiProperty, ApiPropertyOptional, PickType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { IsCalendarDate } from '../../../common/dto/page-number.dto';
import { AccountsQueryDto } from '../../administration/dto/accounts-query.dto';
import {
  CABIN_CATEGORIES,
  CabinCategory,
} from '../schemas/flight-cabin.schema';

export class FlightSearchDto extends PickType(AccountsQueryDto, [
  'page',
] as const) {
  @ApiProperty({ example: 'CAI' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @Matches(/^[A-Z]{3}$/)
  departureAirportCode!: string;
  @ApiProperty({ example: 'JFK' })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toUpperCase() : value,
  )
  @Matches(/^[A-Z]{3}$/)
  arrivalAirportCode!: string;
  @ApiProperty({
    description: 'Calendar date at the departure airport, YYYY-MM-DD',
  })
  @IsCalendarDate()
  departureDate!: string;
  @ApiPropertyOptional({
    description:
      'When supplied, also search reversed-route flights on this local departure date',
  })
  @IsOptional()
  @IsCalendarDate()
  returnDate?: string;
  @ApiPropertyOptional({
    type: Number,
    default: 1,
    minimum: 1,
    description:
      'All passengers, including children/infants; remaining passengers are adults',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  passengers: number = 1;
  @ApiPropertyOptional({ type: Number, default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  children: number = 0;
  @ApiPropertyOptional({ type: Number, default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  infants: number = 0;
  @ApiPropertyOptional({ enum: CABIN_CATEGORIES })
  @IsOptional()
  @IsIn(CABIN_CATEGORIES)
  cabinCategory?: CabinCategory;
  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    description:
      'Inclusive whole-party fare in USD cents for each leg, before extra bags',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  minPriceMinor?: number;
  @ApiPropertyOptional({
    type: Number,
    minimum: 0,
    description:
      'Inclusive whole-party fare in USD cents for each leg, before extra bags',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  maxPriceMinor?: number;
  @ApiPropertyOptional({
    enum: ['price', 'duration', 'departureTime'],
    default: 'price',
  })
  @IsOptional()
  @IsIn(['price', 'duration', 'departureTime'])
  sortBy: 'price' | 'duration' | 'departureTime' = 'price';
  @ApiPropertyOptional({ enum: ['asc', 'desc'], default: 'asc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order: 'asc' | 'desc' = 'asc';
  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    default: 1,
    description: 'Independent return-leg page',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Math.floor(Number.MAX_SAFE_INTEGER / 10))
  returnPage: number = 1;
}
