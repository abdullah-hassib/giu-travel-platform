import { ApiExtraModels, ApiProperty, getSchemaPath } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsHexadecimal,
  IsIn,
  IsMongoId,
  Length,
} from 'class-validator';
import { BOOKING_KINDS, BookingKind } from '../booking-payment.adapter';

export class BookingPolicyParamsDto {
  @ApiProperty({ enum: BOOKING_KINDS })
  @IsIn(BOOKING_KINDS)
  type!: BookingKind;
  @ApiProperty()
  @IsMongoId()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  id!: string;
}

export class AcceptBookingPoliciesDto {
  @ApiProperty({ enum: [true] })
  @IsBoolean()
  @Equals(true)
  accepted!: boolean;
  @ApiProperty({
    minLength: 64,
    maxLength: 64,
    description: 'Token returned by the current policy review',
  })
  @IsHexadecimal()
  @Length(64, 64)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  policyToken!: string;
}

export class CancellationTierDto {
  @ApiProperty({ minimum: 0, type: 'integer' }) daysBefore!: number;
  @ApiProperty({ minimum: 0, maximum: 100 }) refundPercent!: number;
}

export class SegmentBaggagePolicyDto {
  @ApiProperty() segmentId!: string;
  @ApiProperty() cabin!: string;
  @ApiProperty({ minimum: 0, type: 'integer' }) freeBagCount!: number;
  @ApiProperty({ minimum: 0 }) maxWeightKg!: number;
  @ApiProperty({ type: 'integer', minimum: 1 }) extraBagPriceMinor!: number;
  @ApiProperty({ minimum: 0, type: 'integer' }) maxExtraBags!: number;
}

export class FlightBookingPoliciesDto {
  @ApiProperty({ enum: ['flight'] }) type!: 'flight';
  @ApiProperty({ type: [CancellationTierDto] })
  cancellation!: CancellationTierDto[];
  @ApiProperty({ type: [SegmentBaggagePolicyDto] })
  baggage!: SegmentBaggagePolicyDto[];
}

export class HotelBookingPoliciesDto {
  @ApiProperty({ enum: ['hotel'] }) type!: 'hotel';
  @ApiProperty({ type: [CancellationTierDto] })
  cancellation!: CancellationTierDto[];
  @ApiProperty({ example: '14:00' }) checkInTime!: string;
  @ApiProperty({ example: '11:00' }) checkOutTime!: string;
}

@ApiExtraModels(FlightBookingPoliciesDto, HotelBookingPoliciesDto)
export class BookingPolicyReviewDto {
  @ApiProperty({ enum: BOOKING_KINDS }) bookingType!: BookingKind;
  @ApiProperty() bookingId!: string;
  @ApiProperty() providerId!: string;
  @ApiProperty({ type: 'integer' }) amountMinor!: number;
  @ApiProperty({ enum: ['USD'] }) currency!: string;
  @ApiProperty({ format: 'date-time' }) holdExpiresAt!: string;
  @ApiProperty({ minLength: 64, maxLength: 64 }) policyToken!: string;
  @ApiProperty({
    oneOf: [
      { $ref: getSchemaPath(FlightBookingPoliciesDto) },
      { $ref: getSchemaPath(HotelBookingPoliciesDto) },
    ],
  })
  policies!: FlightBookingPoliciesDto | HotelBookingPoliciesDto;
  @ApiProperty() canAccept!: boolean;
  @ApiProperty() accepted!: boolean;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  acceptedAt!: string | null;
}
