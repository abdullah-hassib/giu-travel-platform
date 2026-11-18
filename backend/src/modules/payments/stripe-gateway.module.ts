import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  createStripeTestClient,
  STRIPE_TEST_CLIENT_FACTORY,
  StripeTestGateway,
} from './stripe-test.gateway';

@Module({
  imports: [ConfigModule],
  providers: [
    StripeTestGateway,
    { provide: STRIPE_TEST_CLIENT_FACTORY, useValue: createStripeTestClient },
  ],
  exports: [StripeTestGateway],
})
export class StripeGatewayModule {}
