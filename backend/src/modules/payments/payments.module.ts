import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  BOOKING_PAYMENT_ADAPTERS,
  BookingPaymentAdapters,
} from './booking-payment.adapter';
import { BookingPoliciesController } from './booking-policies.controller';
import { BookingPoliciesService } from './booking-policies.service';
import {
  PolicyAcceptance,
  PolicyAcceptanceSchema,
} from './schemas/policy-acceptance.schema';
import { StripeGatewayModule } from './stripe-gateway.module';

@Module({
  imports: [
    ConfigModule,
    StripeGatewayModule,
    AuthModule,
    MongooseModule.forFeature([
      { name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema },
    ]),
  ],
  controllers: [BookingPoliciesController],
  providers: [
    BookingPaymentAdapters,
    BookingPoliciesService,
    { provide: BOOKING_PAYMENT_ADAPTERS, useValue: [] },
  ],
  exports: [StripeGatewayModule],
})
export class PaymentsModule {}
