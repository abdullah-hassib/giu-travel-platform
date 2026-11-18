import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { CreateFlightCabinDto } from './create-flight-cabin.dto';

export class CreateFlightDto {
  @ApiProperty({ example: 'MS985' })
  @IsString()
  @MaxLength(10)
  @Matches(/^[A-Za-z0-9-]+$/)
  flightNumber!: string;

  @ApiProperty({ example: 'CAI' })
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  departureAirportCode!: string;

  @ApiProperty({ example: 'JFK' })
  @IsString()
  @Matches(/^[A-Za-z]{3}$/)
  arrivalAirportCode!: string;

  @ApiProperty({
    example: '2026-12-10T10:30',
    description: 'Local departure time at the departure airport',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  departureLocalDateTime!: string;

  @ApiProperty({
    example: '2026-12-10T16:30',
    description: 'Local arrival time at the arrival airport',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
  arrivalLocalDateTime!: string;

  @ApiProperty({ type: [CreateFlightCabinDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateFlightCabinDto)
  cabins!: CreateFlightCabinDto[];
}
