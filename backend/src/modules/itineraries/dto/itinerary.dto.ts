import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsMongoId,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { CITY_IDS, COUNTRY_CODES, CURRENCIES } from '../reference-data';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class CreateItineraryDto {
  @ApiProperty({ maxLength: 100 })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  title!: string;

  @ApiProperty({ enum: COUNTRY_CODES, isArray: true, example: ['EG'] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsIn(COUNTRY_CODES, { each: true })
  countryCodes!: string[];

  @ApiProperty({
    example: '2026-11-20',
    description: 'Calendar date, YYYY-MM-DD',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString({ strict: true })
  startDate!: string;
}

export class UpdateItineraryDto extends PartialType(CreateItineraryDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({ enum: ['private', 'public'] })
  @ValidateIf((_object, value) => value !== undefined)
  @IsIn(['private', 'public'])
  visibility?: 'private' | 'public';
}

export class CreateDayDto {
  @ApiProperty({ enum: CITY_IDS, example: 'cairo' })
  @IsIn(CITY_IDS)
  cityId!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  notes?: string | null;
}

export class UpdateDayDto extends PartialType(CreateDayDto, {
  skipNullProperties: false,
}) {}

export class ReorderDaysDto {
  @ApiProperty({
    type: [String],
    description: 'Every current day ID exactly once, in the new order',
  })
  @IsArray()
  @ArrayMaxSize(60)
  @ArrayUnique()
  @IsMongoId({ each: true })
  dayIds!: string[];
}

export class ActivityCostDto {
  @ApiProperty({ minimum: 0, description: 'Integer minor units' })
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  amountMinor!: number;

  @ApiProperty({ enum: CURRENCIES })
  @IsIn(CURRENCIES)
  currency!: string;
}

export class CreateActivityDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  name!: string;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @IsString()
  description?: string | null;

  @ApiPropertyOptional({ example: '14:30', nullable: true })
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  time?: string | null;

  @ApiPropertyOptional({ type: ActivityCostDto, nullable: true })
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => ActivityCostDto)
  cost?: ActivityCostDto | null;
}

export class UpdateActivityDto extends PartialType(CreateActivityDto, {
  skipNullProperties: false,
}) {}

export class ItineraryIdDto {
  @ApiProperty()
  @IsMongoId()
  id!: string;
}

export class DayIdDto extends ItineraryIdDto {
  @ApiProperty()
  @IsMongoId()
  dayId!: string;
}

export class ItinerarySearchDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Math.floor(Number.MAX_SAFE_INTEGER / 10))
  page = 1;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trim)
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: COUNTRY_CODES })
  @IsOptional()
  @IsIn(COUNTRY_CODES)
  countryCode?: string;

  @ApiPropertyOptional({ enum: CITY_IDS })
  @IsOptional()
  @IsIn(CITY_IDS)
  cityId?: string;

  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  minDays?: number;

  @ApiPropertyOptional({ type: Number, minimum: 0, maximum: 60 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(60)
  maxDays?: number;
}

export class ItineraryPageDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Math.floor(Number.MAX_SAFE_INTEGER / 10))
  page = 1;
}
