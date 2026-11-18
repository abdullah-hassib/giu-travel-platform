import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { StripeGatewayModule } from '../payments/stripe-gateway.module';
import { Payment, PaymentSchema } from '../payments/schemas/payment.schema';
import { Refund, RefundSchema } from './schemas/refund.schema';
import {
  RefundOutbox,
  RefundOutboxSchema,
} from './schemas/refund-outbox.schema';
import { RefundsService } from './refunds.service';
import { RefundsController } from './refunds.controller';

@Module({
  imports: [
    AuthModule,
    StripeGatewayModule,
    MongooseModule.forFeature([
      { name: Payment.name, schema: PaymentSchema },
      { name: Refund.name, schema: RefundSchema },
      { name: RefundOutbox.name, schema: RefundOutboxSchema },
    ]),
  ],
  controllers: [RefundsController],
  providers: [RefundsService],
  exports: [RefundsService],
})
export class RefundsModule {}
