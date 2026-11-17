import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import Stripe from 'stripe';
import { PaymentsModule } from './payments.module';
import { assertPlatformMoney, PLATFORM_CURRENCY } from './platform-money';
import {
  STRIPE_TEST_CLIENT_FACTORY,
  StripeTestGateway,
} from './stripe-test.gateway';

// All credentials and Stripe objects in this suite are synthetic. The real SDK
// serializes requests and parses responses through an in-memory fetch transport.
const paymentId = '507f1f77bcf86cd799439011';
const refundId = '507f1f77bcf86cd799439012';
const input = { paymentId, amountMinor: 10000, currency: 'USD' };
const reference = { ...input, intentId: 'pi_fixture' };
const refundInput = { ...reference, refundId, refundAmountMinor: 2500 };
const webhookSecret = 'whsec_syntheticFixtureOnly';

function rawIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'pi_fixture',
    object: 'payment_intent',
    amount: 10000,
    amount_received: 0,
    currency: 'usd',
    livemode: false,
    status: 'requires_payment_method',
    client_secret: 'pi_fixture_secret_synthetic',
    capture_method: 'automatic',
    metadata: { payment_id: paymentId },
    payment_method: { card: { number: 'synthetic-sensitive-data' } },
    ...overrides,
  };
}

function rawRefund(overrides: Record<string, unknown> = {}) {
  return {
    id: 're_fixture',
    object: 'refund',
    payment_intent: 'pi_fixture',
    amount: 2500,
    currency: 'usd',
    status: 'pending',
    metadata: { refund_id: refundId, payment_id: paymentId },
    destination_details: { card: { reference: 'synthetic-sensitive-data' } },
    ...overrides,
  };
}

describe('Stripe test-mode gateway (real SDK, isolated transport)', () => {
  let gateway: StripeTestGateway;
  let transport: jest.Mock<ReturnType<typeof fetch>, Parameters<typeof fetch>>;
  let factory: jest.Mock<Stripe, [string]>;

  beforeEach(() => {
    transport = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();
    factory = jest.fn(
      (key: string) =>
        new Stripe(key, {
          httpClient: Stripe.createFetchHttpClient(transport),
          maxNetworkRetries: 0,
          timeout: 1000,
        }),
    );
    gateway = new StripeTestGateway(
      new ConfigService({
        STRIPE_SECRET_KEY: 'sk_test_syntheticFixtureOnly',
        STRIPE_WEBHOOK_SECRET: webhookSecret,
      }),
      factory,
    );
  });

  function respond(body: unknown, status = 200) {
    transport.mockResolvedValueOnce(
      new Response(JSON.stringify(body), {
        status,
        headers: {
          'content-type': 'application/json',
          'request-id': 'req_fixture',
        },
      }),
    );
  }

  function requestOptions(index = 0) {
    const [url, options] = transport.mock.calls[index];
    return {
      url: String(url),
      headers: new Headers(options?.headers),
      body: new URLSearchParams(String(options?.body ?? '')),
    };
  }

  it('fixes the delegated platform currency as USD and accepts normalized USD input', () => {
    expect(PLATFORM_CURRENCY).toBe('USD');
    expect(() => assertPlatformMoney(1, ' usd ')).not.toThrow();
    expect(() => assertPlatformMoney(1, 'EGP')).toThrow();
  });

  it('creates an automatic-capture card intent with immutable correlation and idempotency', async () => {
    respond(rawIntent());
    const result = await gateway.createIntent(input);
    expect(result).toEqual({
      id: 'pi_fixture',
      paymentId,
      amountMinor: 10000,
      currency: 'USD',
      status: 'requires_payment_method',
      clientSecret: 'pi_fixture_secret_synthetic',
    });
    const request = requestOptions();
    expect(request.url).toBe('https://api.stripe.com/v1/payment_intents');
    expect(request.headers.get('idempotency-key')).toBe(
      `payment:${paymentId}:create`,
    );
    expect(Object.fromEntries(request.body)).toEqual({
      amount: '10000',
      currency: 'usd',
      'allowed_payment_method_types[0]': 'card',
      capture_method: 'automatic',
      'metadata[payment_id]': paymentId,
    });
    expect(JSON.stringify(result)).not.toContain('synthetic-sensitive-data');
  });

  it('normalizes record ID casing so retries keep the same logical operation key', async () => {
    respond(rawIntent());
    respond(rawIntent());
    await gateway.createIntent({
      ...input,
      paymentId: paymentId.toUpperCase(),
    });
    await gateway.createIntent(input);
    expect(requestOptions(0).headers.get('idempotency-key')).toBe(
      requestOptions(1).headers.get('idempotency-key'),
    );
    expect(factory).toHaveBeenCalledTimes(1);
  });

  it.each([0, -1, 1.5, 49, 100000000, Number.MAX_SAFE_INTEGER + 1, NaN])(
    'rejects unsupported Stripe payment amount %p before a request',
    async (amountMinor) => {
      await expect(
        gateway.createIntent({ ...input, amountMinor }),
      ).rejects.toMatchObject({ status: 400 });
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it.each(['EUR', 'EGP', 'JPY', 'BTC', ''])(
    'rejects currency %s before a request',
    async (currency) => {
      await expect(
        gateway.createIntent({ ...input, currency }),
      ).rejects.toMatchObject({ status: 400 });
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'not-an-id', 'someone@example.com'])(
    'rejects invalid payment identity %s',
    async (id) => {
      await expect(
        gateway.createIntent({ ...input, paymentId: id }),
      ).rejects.toMatchObject({ status: 400 });
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it.each(['', 'sk_live_synthetic', 'rk_live_synthetic', 'placeholder'])(
    'requires private test credentials without exposing %p',
    async (key) => {
      const unavailable = new StripeTestGateway(
        new ConfigService({ STRIPE_SECRET_KEY: key }),
        factory,
      );
      await expect(unavailable.createIntent(input)).rejects.toMatchObject({
        status: 503,
        message: 'Stripe test credentials are not configured',
      });
      expect(factory).not.toHaveBeenCalled();
    },
  );

  it('accepts a restricted test API key', async () => {
    const restricted = new StripeTestGateway(
      new ConfigService({ STRIPE_SECRET_KEY: 'rk_test_syntheticFixtureOnly' }),
      factory,
    );
    respond(rawIntent());
    await restricted.createIntent(input);
    expect(factory).toHaveBeenCalledWith('rk_test_syntheticFixtureOnly');
  });

  it.each([
    { livemode: true },
    { currency: 'eur' },
    { amount: 9999 },
    { metadata: { payment_id: refundId } },
    { metadata: null },
    { capture_method: 'manual' },
    { status: 'unknown' },
    { client_secret: undefined },
    { status: 'succeeded', amount_received: 9999 },
  ])('rejects a mismatched gateway payment response (%j)', async (override) => {
    respond(rawIntent(override));
    await expect(gateway.createIntent(input)).rejects.toMatchObject({
      status: 502,
    });
  });

  it('retrieves an intent only when amount, currency, mode and identity match', async () => {
    respond(rawIntent({ status: 'succeeded', amount_received: 10000 }));
    expect((await gateway.retrieveIntent(reference)).status).toBe('succeeded');
    expect(requestOptions().url).toBe(
      'https://api.stripe.com/v1/payment_intents/pi_fixture',
    );
  });

  it('rejects a different intent returned during retrieval', async () => {
    respond(rawIntent({ id: 'pi_different' }));
    await expect(gateway.retrieveIntent(reference)).rejects.toMatchObject({
      status: 502,
    });
  });

  it('validates Stripe resource identifiers before retrieving', async () => {
    await expect(
      gateway.retrieveIntent({ ...reference, intentId: 'pi_fixture/other' }),
    ).rejects.toMatchObject({ status: 400 });
    expect(transport).not.toHaveBeenCalled();
  });

  it('cancels an unpaid intent with a stable expiry key', async () => {
    respond(rawIntent());
    respond(rawIntent({ status: 'canceled', client_secret: null }));
    expect((await gateway.cancelIntent(reference)).status).toBe('canceled');
    expect(requestOptions(1).headers.get('idempotency-key')).toBe(
      `payment:${paymentId}:expire`,
    );
    expect(requestOptions(1).body.get('cancellation_reason')).toBe('abandoned');
  });

  it('returns an already canceled intent without another mutation', async () => {
    respond(rawIntent({ status: 'canceled', client_secret: null }));
    await gateway.cancelIntent(reference);
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('requires refund processing for an already succeeded intent', async () => {
    respond(rawIntent({ status: 'succeeded', amount_received: 10000 }));
    await expect(gateway.cancelIntent(reference)).rejects.toMatchObject({
      status: 409,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it('rejects a non-canceled cancellation response', async () => {
    respond(rawIntent());
    respond(rawIntent({ status: 'processing' }));
    await expect(gateway.cancelIntent(reference)).rejects.toMatchObject({
      status: 502,
    });
  });

  it('creates an authorized partial refund after verifying the paid intent', async () => {
    respond(rawIntent({ status: 'succeeded', amount_received: 10000 }));
    respond(rawRefund());
    const result = await gateway.createRefund(refundInput);
    expect(result).toEqual({
      id: 're_fixture',
      intentId: 'pi_fixture',
      amountMinor: 2500,
      currency: 'USD',
      status: 'Pending',
    });
    expect(requestOptions(1).headers.get('idempotency-key')).toBe(
      `refund:${refundId}:create`,
    );
    expect(Object.fromEntries(requestOptions(1).body)).toEqual({
      payment_intent: 'pi_fixture',
      amount: '2500',
      'metadata[refund_id]': refundId,
      'metadata[payment_id]': paymentId,
    });
    expect(JSON.stringify(result)).not.toContain('synthetic-sensitive-data');
  });

  it.each([0, -1, 0.5, 10001, Number.MAX_SAFE_INTEGER + 1])(
    'rejects unauthorized refund amount %p before a request',
    async (refundAmountMinor) => {
      await expect(
        gateway.createRefund({ ...refundInput, refundAmountMinor }),
      ).rejects.toMatchObject({ status: 400 });
      expect(transport).not.toHaveBeenCalled();
    },
  );

  it('blocks refunds against unpaid intents', async () => {
    respond(rawIntent());
    await expect(gateway.createRefund(refundInput)).rejects.toMatchObject({
      status: 409,
    });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each([
    { payment_intent: 'pi_other' },
    { amount: 1000 },
    { currency: 'eur' },
    { metadata: { refund_id: paymentId, payment_id: paymentId } },
    { status: 'unknown' },
  ])('rejects a mismatched refund response (%j)', async (override) => {
    respond(rawIntent({ status: 'succeeded', amount_received: 10000 }));
    respond(rawRefund(override));
    await expect(gateway.createRefund(refundInput)).rejects.toMatchObject({
      status: 502,
    });
  });

  it.each([
    ['pending', 'Pending'],
    ['requires_action', 'Pending'],
    [null, 'Pending'],
    ['succeeded', 'Refunded'],
    ['failed', 'Failed'],
    ['canceled', 'Failed'],
  ])('retrieves refund status %s as %s', async (status, expected) => {
    respond(rawIntent({ status: 'succeeded', amount_received: 10000 }));
    respond(rawRefund({ status }));
    expect(
      (await gateway.retrieveRefund(refundInput, 're_fixture')).status,
    ).toBe(expected);
  });

  it.each([
    ['card_error', 402, 400, 'Payment was declined'],
    [
      'invalid_request_error',
      400,
      400,
      'Payment request was rejected by Stripe',
    ],
    [
      'authentication_error',
      401,
      503,
      'Stripe test service is unavailable; retry the same operation',
    ],
    [
      'api_error',
      500,
      503,
      'Stripe test service is unavailable; retry the same operation',
    ],
  ])(
    'sanitizes Stripe %s errors',
    async (type, httpStatus, status, message) => {
      respond(
        {
          error: {
            type,
            message: 'synthetic-sensitive-data',
            code: 'test_failure',
          },
        },
        Number(httpStatus),
      );
      await expect(gateway.createIntent(input)).rejects.toMatchObject({
        status,
        message,
      });
    },
  );

  it('sanitizes uncertain transport failures and preserves the retry operation key', async () => {
    transport.mockRejectedValueOnce(new Error('synthetic-sensitive-data'));
    await expect(gateway.createIntent(input)).rejects.toMatchObject({
      status: 503,
    });
    respond(rawIntent());
    await gateway.createIntent(input);
    expect(requestOptions(0).headers.get('idempotency-key')).toBe(
      requestOptions(1).headers.get('idempotency-key'),
    );
  });

  function eventBody(overrides: Record<string, unknown> = {}) {
    return {
      id: 'evt_fixture',
      object: 'event',
      type: 'payment_intent.succeeded',
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: {
        object: rawIntent({ status: 'succeeded', amount_received: 10000 }),
      },
      ...overrides,
    };
  }

  function signed(body: unknown, timestamp?: number) {
    const payload = JSON.stringify(body);
    return {
      raw: Buffer.from(payload),
      signature: Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: webhookSecret,
        timestamp,
      }),
    };
  }

  it('verifies raw bytes with the official SDK and returns minimal correlation metadata', () => {
    const body = eventBody();
    const event = signed(body);
    expect(gateway.verifyWebhook(event.raw, event.signature)).toEqual({
      eventId: 'evt_fixture',
      type: 'payment_intent.succeeded',
      createdAt: new Date(body.created * 1000).toISOString(),
      resourceType: 'payment_intent',
      resourceId: 'pi_fixture',
    });
    expect(transport).not.toHaveBeenCalled();
    expect(factory).not.toHaveBeenCalled();
  });

  it('recognizes refund event identity', () => {
    const event = signed(
      eventBody({ type: 'refund.updated', data: { object: rawRefund() } }),
    );
    expect(gateway.verifyWebhook(event.raw, event.signature)).toMatchObject({
      resourceType: 'refund',
      resourceId: 're_fixture',
    });
  });

  it('keeps unrelated signed events explicitly unhandled', () => {
    const event = signed(
      eventBody({
        type: 'customer.created',
        data: { object: { object: 'customer', id: 'cus_fixture' } },
      }),
    );
    expect(gateway.verifyWebhook(event.raw, event.signature)).toMatchObject({
      resourceType: null,
      resourceId: null,
    });
  });

  it('rejects altered raw bytes and expired signatures', () => {
    const event = signed(eventBody());
    expect(() =>
      gateway.verifyWebhook(
        Buffer.concat([event.raw, Buffer.from(' ')]),
        event.signature,
      ),
    ).toThrow('Invalid Stripe webhook');
    const expired = signed(eventBody(), Math.floor(Date.now() / 1000) - 600);
    expect(() => gateway.verifyWebhook(expired.raw, expired.signature)).toThrow(
      'Invalid Stripe webhook',
    );
  });

  it.each([
    { livemode: true },
    { id: 'not-an-event' },
    { created: -1 },
    { created: Number.MAX_SAFE_INTEGER },
    { data: { object: { object: 'refund', id: 're_fixture' } } },
  ])('rejects a signed malformed or live event (%j)', (override) => {
    const event = signed(eventBody(override));
    expect(() => gateway.verifyWebhook(event.raw, event.signature)).toThrow();
  });

  it('requires a signature and configured signing secret', () => {
    expect(() => gateway.verifyWebhook(Buffer.from('{}'), undefined)).toThrow(
      'signed raw',
    );
    const unavailable = new StripeTestGateway(
      new ConfigService({ STRIPE_WEBHOOK_SECRET: '' }),
      factory,
    );
    expect(() =>
      unavailable.verifyWebhook(Buffer.from('{}'), 'signature'),
    ).toThrow('not configured');
  });

  it.each([null, 42, { ...eventBody(), object: 'customer' }])(
    'rejects a correctly signed invalid event envelope (%j) with 400',
    (body) => {
      const event = signed(body);
      expect(() => gateway.verifyWebhook(event.raw, event.signature)).toThrow(
        expect.objectContaining({ status: 400 }),
      );
    },
  );

  it('loads the real module and remains usable before private configuration exists', async () => {
    const module = await Test.createTestingModule({ imports: [PaymentsModule] })
      .overrideProvider(ConfigService)
      .useValue(
        new ConfigService({ STRIPE_SECRET_KEY: '', STRIPE_WEBHOOK_SECRET: '' }),
      )
      .overrideProvider(STRIPE_TEST_CLIENT_FACTORY)
      .useValue(factory)
      .compile();
    await expect(
      module.get(StripeTestGateway).createIntent(input),
    ).rejects.toMatchObject({ status: 503 });
    expect(factory).not.toHaveBeenCalled();
    await module.close();
  });
});
