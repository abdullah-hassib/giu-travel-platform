import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { assertPlatformMoney, PLATFORM_CURRENCY } from './platform-money';

export const STRIPE_TEST_CLIENT_FACTORY = Symbol('STRIPE_TEST_CLIENT_FACTORY');
export type StripeTestClientFactory = (key: string) => Stripe;
export const createStripeTestClient: StripeTestClientFactory = (key) =>
  new Stripe(key, { maxNetworkRetries: 2, timeout: 5000 });

export interface PaymentIntentInput {
  paymentId: string;
  amountMinor: number;
  currency: string;
}

export interface PaymentIntentReference extends PaymentIntentInput {
  intentId: string;
}

export interface RefundInput extends PaymentIntentReference {
  refundId: string;
  refundAmountMinor: number;
}

export interface GatewayIntent {
  id: string;
  paymentId: string;
  amountMinor: number;
  currency: typeof PLATFORM_CURRENCY;
  status: Stripe.PaymentIntent.Status;
  // Sensitive, transient output for an authorized Elements/retry response only.
  // The consuming payment service must never persist or log it.
  clientSecret: string | null;
}

export interface GatewayRefund {
  id: string;
  intentId: string;
  amountMinor: number;
  currency: typeof PLATFORM_CURRENCY;
  status: 'Pending' | 'Refunded' | 'Failed';
}

export interface VerifiedGatewayEvent {
  eventId: string;
  type: string;
  createdAt: string;
  resourceType: 'payment_intent' | 'refund' | null;
  resourceId: string | null;
}

function recordId(value: string): string {
  if (typeof value !== 'string' || !/^[a-f\d]{24}$/i.test(value)) {
    throw new BadRequestException(
      'Invalid payment or refund record identifier',
    );
  }
  return value.toLowerCase();
}

function stripeId(value: string, prefix: 'pi' | 're'): void {
  if (
    typeof value !== 'string' ||
    !new RegExp(`^${prefix}_[A-Za-z0-9]+$`).test(value)
  ) {
    throw new BadRequestException('Invalid Stripe resource identifier');
  }
}

@Injectable()
export class StripeTestGateway {
  private stripe?: Stripe;

  constructor(
    private readonly config: ConfigService,
    @Inject(STRIPE_TEST_CLIENT_FACTORY)
    private readonly factory: StripeTestClientFactory,
  ) {}

  private client(): Stripe {
    if (!this.stripe) {
      const key = this.config.get<string>('STRIPE_SECRET_KEY');
      if (!key || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(key)) {
        throw new ServiceUnavailableException(
          'Stripe test credentials are not configured',
        );
      }
      this.stripe = this.factory(key);
    }
    return this.stripe;
  }

  private validatePayment(input: PaymentIntentInput): string {
    const paymentId = recordId(input.paymentId);
    assertPlatformMoney(input.amountMinor, input.currency);
    // Stripe's USD limits are distinct from the project's positive-price rule.
    if (input.amountMinor < 50 || input.amountMinor > 99_999_999) {
      throw new BadRequestException(
        'Stripe USD payment amounts must be between 50 and 99999999 cents',
      );
    }
    return paymentId;
  }

  private async request<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (error instanceof Stripe.errors.StripeCardError) {
        throw new BadRequestException('Payment was declined');
      }
      if (error instanceof Stripe.errors.StripeInvalidRequestError) {
        throw new BadRequestException('Payment request was rejected by Stripe');
      }
      // Do not expose provider messages, keys, client secrets or payment method data.
      throw new ServiceUnavailableException(
        'Stripe test service is unavailable; retry the same operation',
      );
    }
  }

  private intentView(
    intent: Stripe.PaymentIntent,
    input: PaymentIntentInput,
    intentId?: string,
  ): GatewayIntent {
    const paymentId = recordId(input.paymentId);
    const statuses: Stripe.PaymentIntent.Status[] = [
      'requires_payment_method',
      'requires_confirmation',
      'requires_action',
      'processing',
      'requires_capture',
      'canceled',
      'succeeded',
    ];
    if (
      !intent ||
      !/^pi_[A-Za-z0-9]+$/.test(intent.id) ||
      (intentId && intent.id !== intentId) ||
      intent.livemode !== false ||
      intent.currency !== 'usd' ||
      intent.amount !== input.amountMinor ||
      intent.metadata?.payment_id !== paymentId ||
      intent.capture_method !== 'automatic' ||
      !statuses.includes(intent.status) ||
      (intent.client_secret !== null &&
        typeof intent.client_secret !== 'string') ||
      (intent.status === 'succeeded' &&
        intent.amount_received !== input.amountMinor)
    ) {
      throw new BadGatewayException(
        'Stripe payment response does not match the expected test payment',
      );
    }
    return {
      id: intent.id,
      paymentId,
      amountMinor: intent.amount,
      currency: PLATFORM_CURRENCY,
      status: intent.status,
      clientSecret: intent.client_secret,
    };
  }

  async createIntent(input: PaymentIntentInput): Promise<GatewayIntent> {
    const paymentId = this.validatePayment(input);
    const stripe = this.client();
    const intent = await this.request(() =>
      stripe.paymentIntents.create(
        {
          amount: input.amountMinor,
          currency: 'usd',
          allowed_payment_method_types: ['card'],
          capture_method: 'automatic',
          metadata: { payment_id: paymentId },
        },
        { idempotencyKey: `payment:${paymentId}:create` },
      ),
    );
    return this.intentView(intent, input);
  }

  async retrieveIntent(input: PaymentIntentReference): Promise<GatewayIntent> {
    this.validatePayment(input);
    stripeId(input.intentId, 'pi');
    const stripe = this.client();
    const intent = await this.request(() =>
      stripe.paymentIntents.retrieve(input.intentId),
    );
    return this.intentView(intent, input, input.intentId);
  }

  async cancelIntent(input: PaymentIntentReference): Promise<GatewayIntent> {
    const current = await this.retrieveIntent(input);
    if (current.status === 'canceled') return current;
    if (current.status === 'succeeded')
      throw new ConflictException('Succeeded payments require a refund');
    const stripe = this.client();
    const intent = await this.request(() =>
      stripe.paymentIntents.cancel(
        input.intentId,
        { cancellation_reason: 'abandoned' },
        { idempotencyKey: `payment:${current.paymentId}:expire` },
      ),
    );
    const result = this.intentView(intent, input, input.intentId);
    if (result.status !== 'canceled')
      throw new BadGatewayException('Stripe has not canceled the payment');
    return result;
  }

  private refundView(
    refund: Stripe.Refund,
    input: RefundInput,
    refundId?: string,
  ): GatewayRefund {
    if (!refund)
      throw new BadGatewayException('Invalid Stripe refund response');
    const intentId =
      typeof refund.payment_intent === 'string'
        ? refund.payment_intent
        : refund.payment_intent?.id;
    if (
      !/^re_[A-Za-z0-9]+$/.test(refund.id) ||
      (refundId && refund.id !== refundId) ||
      intentId !== input.intentId ||
      refund.amount !== input.refundAmountMinor ||
      refund.currency !== 'usd' ||
      refund.metadata?.refund_id !== recordId(input.refundId) ||
      refund.metadata?.payment_id !== recordId(input.paymentId) ||
      ![
        null,
        'pending',
        'requires_action',
        'succeeded',
        'failed',
        'canceled',
      ].includes(refund.status)
    ) {
      throw new BadGatewayException(
        'Stripe refund response does not match the expected refund',
      );
    }
    return {
      id: refund.id,
      intentId,
      amountMinor: refund.amount,
      currency: PLATFORM_CURRENCY,
      status:
        refund.status === 'succeeded'
          ? 'Refunded'
          : refund.status === 'failed' || refund.status === 'canceled'
            ? 'Failed'
            : 'Pending',
    };
  }

  private validateRefund(input: RefundInput): string {
    const refundId = recordId(input.refundId);
    this.validatePayment(input);
    stripeId(input.intentId, 'pi');
    assertPlatformMoney(input.refundAmountMinor, input.currency);
    if (input.refundAmountMinor > input.amountMinor)
      throw new BadRequestException(
        'Refund exceeds the original payment amount',
      );
    return refundId;
  }

  async createRefund(input: RefundInput): Promise<GatewayRefund> {
    const refundId = this.validateRefund(input);
    const paid = await this.retrieveIntent(input);
    if (paid.status !== 'succeeded')
      throw new ConflictException(
        'Refund requires a verified succeeded payment',
      );
    const stripe = this.client();
    const refund = await this.request(() =>
      stripe.refunds.create(
        {
          payment_intent: input.intentId,
          amount: input.refundAmountMinor,
          metadata: { refund_id: refundId, payment_id: paid.paymentId },
        },
        { idempotencyKey: `refund:${refundId}:create` },
      ),
    );
    return this.refundView(refund, input);
  }

  async retrieveRefund(
    input: RefundInput,
    stripeRefundId: string,
  ): Promise<GatewayRefund> {
    this.validateRefund(input);
    stripeId(stripeRefundId, 're');
    const paid = await this.retrieveIntent(input);
    if (paid.status !== 'succeeded')
      throw new ConflictException(
        'Refund requires a verified succeeded payment',
      );
    const stripe = this.client();
    const refund = await this.request(() =>
      stripe.refunds.retrieve(stripeRefundId),
    );
    return this.refundView(refund, input, stripeRefundId);
  }

  verifyWebhook(
    rawBody: Buffer,
    signature: string | undefined,
  ): VerifiedGatewayEvent {
    if (
      !Buffer.isBuffer(rawBody) ||
      !signature ||
      typeof signature !== 'string'
    ) {
      throw new BadRequestException(
        'A signed raw Stripe webhook body is required',
      );
    }
    const secret = this.config.get<string>('STRIPE_WEBHOOK_SECRET');
    if (!secret?.startsWith('whsec_') || secret.length <= 6) {
      throw new ServiceUnavailableException(
        'Stripe webhook verification is not configured',
      );
    }
    let event: Stripe.Event;
    try {
      event = Stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch {
      throw new BadRequestException(
        'Invalid Stripe webhook signature or payload',
      );
    }
    if (
      !event ||
      typeof event !== 'object' ||
      event.object !== 'event' ||
      event.livemode !== false ||
      !/^evt_[A-Za-z0-9]+$/.test(event.id) ||
      !Number.isSafeInteger(event.created) ||
      event.created <= 0 ||
      !Number.isFinite(new Date(event.created * 1000).getTime()) ||
      typeof event.type !== 'string'
    ) {
      throw new BadRequestException('A valid Stripe test event is required');
    }
    const resourceType = event.type.startsWith('payment_intent.')
      ? 'payment_intent'
      : event.type.startsWith('refund.')
        ? 'refund'
        : null;
    const object = event.data?.object;
    if (
      resourceType &&
      (!object ||
        object.object !== resourceType ||
        !('id' in object) ||
        typeof object.id !== 'string' ||
        !(
          resourceType === 'payment_intent'
            ? /^pi_[A-Za-z0-9]+$/
            : /^re_[A-Za-z0-9]+$/
        ).test(object.id))
    ) {
      throw new BadRequestException('Invalid Stripe event resource');
    }
    return {
      eventId: event.id,
      type: event.type,
      createdAt: new Date(event.created * 1000).toISOString(),
      resourceType,
      resourceId:
        resourceType && object && 'id' in object ? String(object.id) : null,
    };
  }
}
