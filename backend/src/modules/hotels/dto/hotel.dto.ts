import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
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
import {
  IsCalendarDate,
  PageNumberDto,
} from '../../../common/dto/page-number.dto';
import {
  CITY_IDS,
  COUNTRY_CODES,
} from '../../reference-data/official-reference';
import {
  BOOKING_STATUSES,
  BookingStatus,
} from '../../hotel-bookings/schemas/hotel-booking.schema';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
// Optional, but an explicit null is rejected rather than saved.
const isPresent = (_dto: object, value: unknown) => value !== undefined;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateHotelDto {
  @ApiProperty({ maxLength: 120, example: 'Nile View Hotel' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(120)
  name!: string;

  @ApiPropertyOptional({ maxLength: 2000 })
  @ValidateIf(isPresent)
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ maxLength: 300, example: '12 Corniche St' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(300)
  address!: string;

  @ApiProperty({ enum: CITY_IDS, example: 'cairo' })
  @IsIn(CITY_IDS)
  cityId!: string;

  @ApiProperty({ enum: COUNTRY_CODES, example: 'EG' })
  @IsIn(COUNTRY_CODES)
  countryCode!: string;

  @ApiProperty({ minimum: 1, maximum: 5, example: 4 })
  @IsInt()
  @Min(1)
  @Max(5)
  starRating!: number;

  @ApiPropertyOptional({ type: [String], example: ['Wi-Fi', 'Pool'] })
  @ValidateIf(isPresent)
  @IsArray()
  @ArrayMaxSize(30)
  @ArrayUnique()
  @IsString({ each: true })
  @MinLength(1, { each: true })
  @MaxLength(50, { each: true })
  amenities?: string[];
}

export class UpdateHotelDto extends PartialType(CreateHotelDto, {
  skipNullProperties: false,
}) {}

export class HotelStatusDto {
  @ApiProperty({
    description: 'false deactivates the hotel, true reactivates it',
  })
  @IsBoolean()
  active!: boolean;
}

export class CancellationTierDto {
  @ApiProperty({ minimum: 0, example: 7, description: 'Days before check-in' })
  @IsInt()
  @Min(0)
  @Max(3650)
  daysBefore!: number;

  @ApiProperty({ minimum: 0, maximum: 100, example: 50 })
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(0)
  @Max(100)
  refundPercent!: number;
}

export class HotelPoliciesDto {
  @ApiProperty({ example: '14:00', description: 'HH:mm' })
  @Matches(TIME, { message: 'checkInTime must use HH:mm' })
  checkInTime!: string;

  @ApiProperty({ example: '12:00', description: 'HH:mm' })
  @Matches(TIME, { message: 'checkOutTime must use HH:mm' })
  checkOutTime!: string;

  @ApiProperty({ type: [CancellationTierDto] })
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CancellationTierDto)
  cancellationTiers!: CancellationTierDto[];
}

export class StayQueryDto {
  @ApiProperty({ example: '2026-12-01' })
  @IsCalendarDate()
  checkIn!: string;

  @ApiProperty({ example: '2026-12-04' })
  @IsCalendarDate()
  checkOut!: string;
}

export class OptionalStayQueryDto {
  @ApiPropertyOptional({
    example: '2026-12-01',
    description: 'Send with checkOut to list free rooms',
  })
  @IsOptional()
  @IsCalendarDate()
  checkIn?: string;

  @ApiPropertyOptional({ example: '2026-12-04' })
  @IsOptional()
  @IsCalendarDate()
  checkOut?: string;
}

export class HotelSearchDto extends PageNumberDto {
  @ApiPropertyOptional({
    enum: CITY_IDS,
    description: 'City or country is required',
  })
  @IsOptional()
  @IsIn(CITY_IDS)
  cityId?: string;

  @ApiPropertyOptional({ enum: COUNTRY_CODES })
  @IsOptional()
  @IsIn(COUNTRY_CODES)
  countryCode?: string;

  @ApiProperty({ example: '2026-12-01' })
  @IsCalendarDate()
  checkIn!: string;

  @ApiProperty({ example: '2026-12-04' })
  @IsCalendarDate()
  checkOut!: string;

  @ApiProperty({ minimum: 1, example: 2 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  guests!: number;

  @ApiPropertyOptional({ minimum: 1, default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  rooms = 1;

  @ApiPropertyOptional({
    description: 'Cheapest free room per night, USD cents, inclusive',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  minPriceMinor?: number;

  @ApiPropertyOptional({
    description: 'Cheapest free room per night, USD cents, inclusive',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  maxPriceMinor?: number;

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    description: 'Unrated hotels are excluded',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @Min(1)
  @Max(5)
  minRating?: number;

  @ApiPropertyOptional({ enum: ['price', 'rating'], default: 'price' })
  @IsOptional()
  @IsIn(['price', 'rating'])
  sortBy: 'price' | 'rating' = 'price';

  @ApiPropertyOptional({
    enum: ['asc', 'desc'],
    description: 'Default: price asc, rating desc',
  })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

export class ReservationsQueryDto extends PageNumberDto {
  @ApiPropertyOptional({ enum: BOOKING_STATUSES })
  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: BookingStatus;
}

export class AvailabilityQueryDto extends PageNumberDto {
  @ApiProperty({ example: '2026-12-01', description: 'First night shown' })
  @IsCalendarDate()
  from!: string;

  @ApiProperty({
    example: '2026-12-08',
    description: 'Day after the last night shown (max 31 nights)',
  })
  @IsCalendarDate()
  to!: string;
}
