import { ApiProperty } from '@nestjs/swagger';
import { AirportDto } from '../../reference-data/reference.dto';
import { CABIN_CATEGORIES } from '../schemas/flight-cabin.schema';
import { CancellationPolicyTierDto } from '../../airlines/dto/cancellation-policy-tier.dto';

class PublicFlightAirlineDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() code!: string;
  @ApiProperty() logoUrl!: string;
}
export class FlightCabinOptionDto {
  @ApiProperty({ enum: CABIN_CATEGORIES }) category!: string;
  @ApiProperty({ type: 'integer' }) pricePerSeatMinor!: number;
  @ApiProperty({
    type: 'integer',
    description: 'Selected-party fare for this leg, excluding optional bags',
  })
  totalAmountMinor!: number;
  @ApiProperty({ type: 'integer', minimum: 0 }) availableSeats!: number;
  @ApiProperty({ type: 'integer' }) freeBags!: number;
  @ApiProperty() maxWeightPerBag!: number;
}
export class PublicFlightDetailsDto {
  @ApiProperty() id!: string;
  @ApiProperty() flightNumber!: string;
  @ApiProperty({ enum: ['Scheduled', 'Cancelled', 'Departed'] })
  status!: string;
  @ApiProperty({ type: PublicFlightAirlineDto })
  airline!: PublicFlightAirlineDto;
  @ApiProperty({ type: AirportDto }) departureAirport!: AirportDto;
  @ApiProperty({ type: AirportDto }) arrivalAirport!: AirportDto;
  @ApiProperty({ type: String, format: 'date-time' }) departureAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) arrivalAt!: string;
  @ApiProperty({ description: 'Airport-local ISO time including UTC offset' })
  departureLocalDateTime!: string;
  @ApiProperty({ description: 'Airport-local ISO time including UTC offset' })
  arrivalLocalDateTime!: string;
  @ApiProperty() durationMinutes!: number;
  @ApiProperty({ type: [FlightCabinOptionDto] })
  cabins!: FlightCabinOptionDto[];
  @ApiProperty({
    type: 'integer',
    description: 'Lowest eligible cabin total in USD cents',
  })
  totalAmountMinor!: number;
  @ApiProperty({ enum: ['USD'] }) currency!: string;
  @ApiProperty({
    type: Number,
    nullable: true,
    description: 'USD cents per extra bag; null if not yet configured',
  })
  extraBagPriceMinor!: number | null;
  @ApiProperty({ type: Number, nullable: true }) maxExtraBags!: number | null;
  @ApiProperty({ type: [CancellationPolicyTierDto] })
  cancellationPolicy!: CancellationPolicyTierDto[];
}
class FlightSearchPageMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty({ enum: [10] }) limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}
export class FlightSearchPageDto {
  @ApiProperty({ type: [PublicFlightDetailsDto] })
  data!: PublicFlightDetailsDto[];
  @ApiProperty({ type: FlightSearchPageMetaDto })
  meta!: FlightSearchPageMetaDto;
}
class FlightSearchCriteriaDto {
  @ApiProperty() departureAirportCode!: string;
  @ApiProperty({ type: [String] }) arrivalAirportCodes!: string[];
  @ApiProperty() departureDate!: string;
  @ApiProperty({ type: String, nullable: true }) returnDate!: string | null;
  @ApiProperty() passengers!: number;
  @ApiProperty() adults!: number;
  @ApiProperty() children!: number;
  @ApiProperty() infants!: number;
  @ApiProperty() seatsRequired!: number;
}
export class FlightSearchResponseDto {
  @ApiProperty({ type: FlightSearchCriteriaDto })
  criteria!: FlightSearchCriteriaDto;
  @ApiProperty({ type: FlightSearchPageDto }) outbound!: FlightSearchPageDto;
  @ApiProperty({ type: FlightSearchPageDto, nullable: true })
  inbound!: FlightSearchPageDto | null;
}
