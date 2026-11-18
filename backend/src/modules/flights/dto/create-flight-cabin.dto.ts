import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsNumber, Min, Max } from 'class-validator';
import {
  CABIN_CATEGORIES,
  CabinCategory,
} from '../schemas/flight-cabin.schema';

export class CreateFlightCabinDto {
  @ApiProperty({ enum: CABIN_CATEGORIES, example: 'Economy' })
  @IsEnum(CABIN_CATEGORIES)
  category!: CabinCategory;

  @ApiProperty({ example: 180, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  totalSeats!: number;

  @ApiProperty({
    example: 45000,
    minimum: 1,
    description: 'Cabin price in USD cents',
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(Number.MAX_SAFE_INTEGER)
  price!: number;

  @ApiProperty({ example: 1, minimum: 0 })
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  freeBags!: number;

  @ApiProperty({ example: 23, minimum: 0.01 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  maxWeightPerBag!: number;
}
