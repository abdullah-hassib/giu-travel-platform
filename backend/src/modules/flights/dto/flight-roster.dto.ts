import { ApiProperty, PickType } from '@nestjs/swagger';
import { AccountsQueryDto } from '../../administration/dto/accounts-query.dto';
import { CABIN_CATEGORIES } from '../schemas/flight-cabin.schema';

export class FlightRosterQueryDto extends PickType(AccountsQueryDto, [
  'page',
] as const) {}
class FlightRosterCabinDto {
  @ApiProperty({ enum: CABIN_CATEGORIES }) category!: string;
  @ApiProperty() totalSeats!: number;
  @ApiProperty() bookedSeats!: number;
  @ApiProperty() heldSeats!: number;
  @ApiProperty() availableSeats!: number;
}
class FlightRosterSummaryDto {
  @ApiProperty() id!: string;
  @ApiProperty() flightNumber!: string;
  @ApiProperty({ enum: ['Scheduled', 'Cancelled', 'Departed'] })
  status!: string;
  @ApiProperty({ type: String, format: 'date-time' }) departureAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) arrivalAt!: string;
  @ApiProperty({ type: [FlightRosterCabinDto] })
  cabins!: FlightRosterCabinDto[];
}
export class FlightRosterBookingDto {
  @ApiProperty() bookingId!: string;
  @ApiProperty() reference!: string;
  @ApiProperty({ type: [String] }) passengerNames!: string[];
  @ApiProperty({ enum: CABIN_CATEGORIES }) cabinCategory!: string;
  @ApiProperty() seatsReserved!: number;
  @ApiProperty({ enum: ['Confirmed', 'Cancelled'] }) status!:
    'Confirmed' | 'Cancelled';
}
class FlightRosterMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty({ enum: [10] }) limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}
export class FlightRosterResponseDto {
  @ApiProperty({ type: FlightRosterSummaryDto })
  flight!: FlightRosterSummaryDto;
  @ApiProperty({ type: [FlightRosterBookingDto] })
  data!: FlightRosterBookingDto[];
  @ApiProperty({ type: FlightRosterMetaDto }) meta!: FlightRosterMetaDto;
}
