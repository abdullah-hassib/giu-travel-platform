import {
  IsMongoId,
  IsNotEmpty,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { CreateBookingPassengerDto } from './create-booking-passenger.dto';

export class PrepareFlightBookingDto {
  @IsMongoId()
  flightId!: string;

  @IsString()
  @IsNotEmpty()
  cabinCategory!: string;

  @ValidateNested({ each: true })
  @Type(() => CreateBookingPassengerDto)
  passengers!: CreateBookingPassengerDto[];
}
