import { ApiProperty } from '@nestjs/swagger';
import { FlightBookingPoliciesDto } from '../../payments/dto/booking-policies.dto';
import { CABIN_CATEGORIES } from '../../flights/schemas/flight-cabin.schema';
import { FLIGHT_BOOKING_STATUSES } from '../schemas/flight-booking.schema';

class FlightPassengerViewDto {
  @ApiProperty() fullName!: string;
  @ApiProperty({ type: String, format: 'date-time' }) dateOfBirth!: string;
  @ApiProperty({ enum: ['Adult', 'Child', 'Infant'] }) passengerType!: string;
  @ApiProperty({ description: 'Private owner/assigned-moderator field' })
  identityDocumentNumber!: string;
  @ApiProperty({ type: 'integer', minimum: 0 }) extraBags!: number;
  @ApiProperty({ type: [Number] }) extraBagWeightsKg!: number[];
  @ApiProperty({
    type: 'integer',
    description: 'Sum across all segments, in USD cents',
  })
  extraBaggageFeeMinor!: number;
}
export class FlightSegmentViewDto {
  @ApiProperty() flightId!: string;
  @ApiProperty() airlineId!: string;
  @ApiProperty() airlineName!: string;
  @ApiProperty() flightNumber!: string;
  @ApiProperty() departureAirportCode!: string;
  @ApiProperty() arrivalAirportCode!: string;
  @ApiProperty({ type: String, format: 'date-time' }) departureAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) arrivalAt!: string;
  @ApiProperty({
    description: 'Calendar date at the departure airport, YYYY-MM-DD',
  })
  departureLocalDate!: string;
  @ApiProperty({ enum: CABIN_CATEGORIES }) cabinCategory!: string;
  @ApiProperty({ type: 'integer' }) seatsReserved!: number;
  @ApiProperty({ type: 'integer', description: 'USD cents' })
  baseFareMinor!: number;
  @ApiProperty({
    type: 'integer',
    description: 'USD cents including baggage for this segment',
  })
  segmentTotalMinor!: number;
}
class FlightRefundPreviewDto {
  @ApiProperty({ minimum: 0, maximum: 100 }) refundPercent!: number;
  @ApiProperty({
    type: 'integer',
    description: 'USD cents under saved outbound tiers',
  })
  refundMinor!: number;
}
export class FlightBookingViewDto {
  @ApiProperty() id!: string;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Generated only after verified payment',
  })
  reference!: string | null;
  @ApiProperty({ enum: FLIGHT_BOOKING_STATUSES }) status!: string;
  @ApiProperty({ type: [FlightSegmentViewDto] })
  segments!: FlightSegmentViewDto[];
  @ApiProperty({ type: [FlightPassengerViewDto] })
  passengers!: FlightPassengerViewDto[];
  @ApiProperty({
    type: 'integer',
    description: 'Whole-booking total in USD cents',
  })
  totalAmountMinor!: number;
  @ApiProperty({ enum: ['USD'] }) currency!: string;
  @ApiProperty({ type: String, format: 'date-time' }) holdExpiresAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  confirmedAt!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  cancelledAt!: string | null;
  @ApiProperty({ type: FlightBookingPoliciesDto })
  policies!: FlightBookingPoliciesDto;
  @ApiProperty({ type: FlightRefundPreviewDto, nullable: true })
  refundPreview!: FlightRefundPreviewDto | null;
  @ApiProperty({ type: Number, nullable: true }) refundMinor!: number | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}
class FlightHoldInfoDto {
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ enum: [10] }) durationMinutes!: number;
}
export class FlightHoldViewDto {
  @ApiProperty({ type: FlightBookingViewDto }) booking!: FlightBookingViewDto;
  @ApiProperty({ type: FlightHoldInfoDto }) hold!: FlightHoldInfoDto;
}
class FlightBookingPageMetaDto {
  @ApiProperty() page!: number;
  @ApiProperty({ enum: [10] }) limit!: number;
  @ApiProperty() total!: number;
  @ApiProperty() totalPages!: number;
}
export class FlightBookingsPageDto {
  @ApiProperty({ type: [FlightBookingViewDto] }) data!: FlightBookingViewDto[];
  @ApiProperty({ type: FlightBookingPageMetaDto })
  meta!: FlightBookingPageMetaDto;
}
class UnreservedFlightSummaryDto {
  @ApiProperty({ enum: ['Not created'] }) status!: string;
  @ApiProperty({ enum: [false] }) seatsReserved!: boolean;
  @ApiProperty({ enum: [false] }) holdCreated!: boolean;
}
export class FlightSummaryViewDto {
  @ApiProperty({ type: [FlightSegmentViewDto] })
  segments!: FlightSegmentViewDto[];
  @ApiProperty({ type: [FlightPassengerViewDto] })
  passengers!: FlightPassengerViewDto[];
  @ApiProperty({ type: 'integer' }) totalAmountMinor!: number;
  @ApiProperty({ enum: ['USD'] }) currency!: string;
  @ApiProperty({ type: FlightBookingPoliciesDto })
  policies!: FlightBookingPoliciesDto;
  @ApiProperty({ type: UnreservedFlightSummaryDto })
  booking!: UnreservedFlightSummaryDto;
}
