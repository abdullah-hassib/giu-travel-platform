import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDate } from '../../../common/dto/page-number.dto';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

export class RoomParamsDto {
  @ApiProperty()
  @IsMongoId()
  id!: string;

  @ApiProperty()
  @IsMongoId()
  roomId!: string;
}

export class CreateRoomDto {
  @ApiProperty({
    example: '101',
    description: 'Room number or name, unique within the hotel',
  })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @ApiProperty({ example: 'Double' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  type!: string;

  @ApiProperty({ minimum: 1, example: 1 })
  @IsInt()
  @Min(1)
  @Max(20)
  beds!: number;

  @ApiProperty({ minimum: 1, example: 2 })
  @IsInt()
  @Min(1)
  @Max(20)
  maxOccupancy!: number;

  @ApiProperty({
    minimum: 1,
    example: 12000,
    description: 'USD cents per night',
  })
  @IsInt()
  @Min(1)
  @Max(10_000_000)
  pricePerNightMinor!: number;
}

export class UpdateRoomDto extends PartialType(CreateRoomDto, {
  skipNullProperties: false,
}) {
  @ApiPropertyOptional({ description: 'false deactivates the room (HTL-06)' })
  @ValidateIf((_dto, value) => value !== undefined)
  @IsBoolean()
  active?: boolean;
}

export class NightRangeDto {
  @ApiProperty({ example: '2026-12-01', description: 'First night' })
  @IsCalendarDate()
  from!: string;

  @ApiProperty({
    example: '2027-01-01',
    description: 'Day after the last night',
  })
  @IsCalendarDate()
  to!: string;
}

export class UpdateRoomAvailabilityDto {
  @ApiPropertyOptional({
    type: [NightRangeDto],
    description: 'Replaces all bookable ranges (HTL-05)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => NightRangeDto)
  availability?: NightRangeDto[];

  @ApiPropertyOptional({
    type: [NightRangeDto],
    description: 'Replaces all blocked ranges (HTL-06)',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => NightRangeDto)
  blocked?: NightRangeDto[];
}
