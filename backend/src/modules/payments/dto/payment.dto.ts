import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsMongoId } from 'class-validator';
import { BOOKING_KINDS, BookingKind } from '../booking-payment.adapter';

export class CreatePaymentDto {
  @ApiProperty({ enum: BOOKING_KINDS })
  @IsIn(BOOKING_KINDS)
  bookingType!: BookingKind;
  @ApiProperty()
  @IsMongoId()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  bookingId!: string;
}
export class PaymentIdDto {
  @ApiProperty()
  @IsMongoId()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.toLowerCase() : value,
  )
  id!: string;
}
export class RetryPaymentDto {}

export class RefundViewDto {
  @ApiProperty() id!: string;
  @ApiProperty() paymentId!: string;
  @ApiProperty() bookingId!: string;
  @ApiProperty({ enum: BOOKING_KINDS }) bookingType!: BookingKind;
  @ApiProperty({ type: 'integer' }) amountMinor!: number;
  @ApiProperty({ enum: ['USD'] }) currency!: string;
  @ApiProperty({ enum: ['Pending', 'Refunded', 'Failed'] }) status!: string;
  @ApiProperty({
    enum: ['user_cancellation', 'provider_cancellation', 'late_payment'],
  })
  reason!: string;
}

export class PaymentViewDto {
  @ApiProperty() id!: string;
  @ApiProperty() bookingId!: string;
  @ApiProperty({ enum: BOOKING_KINDS }) bookingType!: BookingKind;
  @ApiProperty({ type: 'integer' }) amountMinor!: number;
  @ApiProperty({ enum: ['USD'] }) currency!: string;
  @ApiProperty() status!: string;
  @ApiProperty({ enum: ['pending', 'confirmed', 'expired'] })
  fulfillment!: string;
  @ApiProperty({ type: String, nullable: true }) stripePaymentId!:
    string | null;
  @ApiProperty({ format: 'date-time' }) holdExpiresAt!: string;
  @ApiProperty({ format: 'date-time' }) policiesAcceptedAt!: string;
  @ApiProperty({ type: [RefundViewDto] }) refunds!: RefundViewDto[];
}

export class PaymentAttemptDto {
  @ApiProperty({ type: PaymentViewDto }) payment!: PaymentViewDto;
  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Transient owner-only Elements result. Never persist or log.',
  })
  clientSecret!: string | null;
}
