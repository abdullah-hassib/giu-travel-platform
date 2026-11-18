import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { HotelBookingsModule } from '../hotel-bookings/hotel-bookings.module';
import { HotelPaymentAdapter } from '../hotel-bookings/hotel-payment.adapter';
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
import { RefundsModule } from '../refunds/refunds.module';
import { Payment, PaymentSchema } from './schemas/payment.schema';
import {
  PaymentEvent,
  PaymentEventSchema,
} from './schemas/payment-event.schema';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { PaymentWebhookController } from './payment-webhook.controller';
import { PaymentReconciliationWorker } from './payment-reconciliation.worker';

@Module({
  imports: [
    ConfigModule,
    StripeGatewayModule,
    AuthModule,
    RefundsModule,
    HotelBookingsModule,
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: PolicyAcceptance.name, schema: PolicyAcceptanceSchema },
      { name: Payment.name, schema: PaymentSchema },
      { name: PaymentEvent.name, schema: PaymentEventSchema },
    ]),
  ],
  controllers: [
    BookingPoliciesController,
    PaymentsController,
    PaymentWebhookController,
  ],
  providers: [
    BookingPaymentAdapters,
    BookingPoliciesService,
    PaymentsService,
    PaymentReconciliationWorker,
    {
      provide: BOOKING_PAYMENT_ADAPTERS,
      useFactory: (hotel: HotelPaymentAdapter) => [hotel],
      inject: [HotelPaymentAdapter],
    },
  ],
  exports: [StripeGatewayModule],
})
export class PaymentsModule {}
