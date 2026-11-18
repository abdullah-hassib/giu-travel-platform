import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsMongoId,
  IsOptional,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { CreateBookingPassengerDto } from './create-booking-passenger.dto';
import {
  CABIN_CATEGORIES,
  CabinCategory,
} from '../../flights/schemas/flight-cabin.schema';

export class HoldFlightBookingDto {
  @ApiProperty()
  @IsMongoId()
  flightId!: string;

  @ApiProperty({ enum: CABIN_CATEGORIES })
  @IsIn(CABIN_CATEGORIES)
  cabinCategory!: CabinCategory;

  @ApiPropertyOptional({
    description:
      'Optional reversed-route return flight, paid/cancelled with the outbound',
  })
  @IsOptional()
  @IsMongoId()
  returnFlightId?: string;

  @ApiPropertyOptional({
    enum: CABIN_CATEGORIES,
    description: 'Defaults to outbound category',
  })
  @IsOptional()
  @IsIn(CABIN_CATEGORIES)
  returnCabinCategory?: CabinCategory;

  @ApiProperty({ type: [CreateBookingPassengerDto], minItems: 1 })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateBookingPassengerDto)
  passengers!: CreateBookingPassengerDto[];
}
