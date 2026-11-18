import { ApiProperty, PartialType, PickType } from '@nestjs/swagger';
import { Equals, IsBoolean, IsIn } from 'class-validator';
import { IdParamDto } from '../../../common/dto/id-param.dto';
import { CreateFlightDto } from './create-flight.dto';
import { CreateFlightCabinDto } from './create-flight-cabin.dto';
import { FlightViewDto } from './flight-view.dto';
import {
  CABIN_CATEGORIES,
  CabinCategory,
} from '../schemas/flight-cabin.schema';

export class UpdateFlightDto extends PartialType(
  PickType(CreateFlightDto, [
    'departureAirportCode',
    'arrivalAirportCode',
    'departureLocalDateTime',
    'arrivalLocalDateTime',
  ] as const),
  { skipNullProperties: false },
) {}
export class UpdateFlightCabinDto extends PartialType(
  PickType(CreateFlightCabinDto, ['totalSeats', 'price'] as const),
  { skipNullProperties: false },
) {}
export class FlightCabinParamsDto extends IdParamDto {
  @ApiProperty({
    enum: CABIN_CATEGORIES,
    description: 'Stable cabin category identifier; URL-encode spaces',
  })
  @IsIn(CABIN_CATEGORIES)
  cabinId!: CabinCategory;
}
export class CancelFlightDto {
  @ApiProperty({
    enum: [true],
    description:
      'Explicit confirmation of whole-flight cancellation and full refunds',
  })
  @IsBoolean()
  @Equals(true)
  confirmed!: true;
}
export class CancelFlightResultDto {
  @ApiProperty({ type: FlightViewDto }) flight!: FlightViewDto;
  @ApiProperty() cancelledBookings!: number;
  @ApiProperty() expiredHolds!: number;
}
