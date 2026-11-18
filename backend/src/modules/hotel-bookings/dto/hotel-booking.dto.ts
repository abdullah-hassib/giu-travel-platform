import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsMongoId,
  IsOptional,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  IsCalendarDate,
  PageNumberDto,
} from '../../../common/dto/page-number.dto';

export class BookingRoomDto {
  @ApiProperty()
  @IsMongoId()
  roomId!: string;

  @ApiProperty({ minimum: 0, example: 2 })
  @IsInt()
  @Min(0)
  @Max(20)
  adults!: number;

  @ApiPropertyOptional({
    type: [Number],
    example: [7],
    description: 'One age (0-17) per child',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(17, { each: true })
  childrenAges: number[] = [];
}

export class CreateHotelBookingDto {
  @ApiProperty()
  @IsMongoId()
  hotelId!: string;

  @ApiProperty({ example: '2026-12-01' })
  @IsCalendarDate()
  checkIn!: string;

  @ApiProperty({ example: '2026-12-04' })
  @IsCalendarDate()
  checkOut!: string;

  @ApiProperty({
    type: [BookingRoomDto],
    description: 'One or more rooms of the same hotel',
  })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => BookingRoomDto)
  rooms!: BookingRoomDto[];
}

export const BOOKING_GROUPS = ['upcoming', 'past', 'cancelled'] as const;
export type BookingGroup = (typeof BOOKING_GROUPS)[number];

export class MyBookingsQueryDto extends PageNumberDto {
  @ApiPropertyOptional({
    enum: BOOKING_GROUPS,
    default: 'upcoming',
    description:
      'upcoming: Pending Payment/Confirmed, past: Completed/Expired, cancelled: Cancelled',
  })
  @IsOptional()
  @IsIn(BOOKING_GROUPS)
  group: BookingGroup = 'upcoming';
}
