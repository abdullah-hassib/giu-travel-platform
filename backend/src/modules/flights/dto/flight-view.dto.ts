import { ApiProperty } from '@nestjs/swagger';
import { CreateFlightCabinDto } from './create-flight-cabin.dto';
import { FLIGHT_STATUSES } from '../schemas/flight.schema';

export class FlightCabinViewDto extends CreateFlightCabinDto {
  @ApiProperty({ type: 'integer', minimum: 0 }) bookedSeats!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) heldSeats!: number;
}
export class FlightViewDto {
  @ApiProperty() id!: string;
  @ApiProperty() airlineId!: string;
  @ApiProperty() flightNumber!: string;
  @ApiProperty({ description: 'Official IATA identifier' })
  departureAirportId!: string;
  @ApiProperty({ description: 'Official IATA identifier' })
  arrivalAirportId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) departureAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) arrivalAt!: string;
  @ApiProperty({ description: 'Date at the departure airport, YYYY-MM-DD' })
  departureLocalDate!: string;
  @ApiProperty({ enum: FLIGHT_STATUSES }) status!: string;
  @ApiProperty({ type: [FlightCabinViewDto] }) cabins!: FlightCabinViewDto[];
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: string;
}
