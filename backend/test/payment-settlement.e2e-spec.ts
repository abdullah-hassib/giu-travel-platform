import {
  BadGatewayException,
  ConflictException,
  Global,
  INestApplication,
  Module,
  NotFoundException,
  ServiceUnavailableException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getConnectionToken,
  getModelToken,
  MongooseModule,
} from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ClientSession, Connection, Model, Schema, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import Stripe from 'stripe';
import request from 'supertest';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { hashPassword } from '../src/modules/auth/security/password';
import { User, UserRole } from '../src/modules/users/schemas/user.schema';
import { UserSession } from '../src/modules/auth/schemas/user-session.schema';
import { PaymentsModule } from '../src/modules/payments/payments.module';
import {
  BOOKING_PAYMENT_ADAPTERS,
  BookingKind,
  BookingPaymentAdapter,
  BookingPaymentSnapshot,
  BookingSettlementAdapter,
} from '../src/modules/payments/booking-payment.adapter';
import {
  StripeTestGateway,
  GatewayIntent,
  GatewayRefund,
  PaymentIntentInput,
  PaymentIntentReference,
  RefundInput,
} from '../src/modules/payments/stripe-test.gateway';
import { Payment } from '../src/modules/payments/schemas/payment.schema';
import { PaymentEvent } from '../src/modules/payments/schemas/payment-event.schema';
import { PolicyAcceptance } from '../src/modules/payments/schemas/policy-acceptance.schema';
import { Refund } from '../src/modules/refunds/schemas/refund.schema';
import { RefundOutbox } from '../src/modules/refunds/schemas/refund-outbox.schema';
import { RefundsService } from '../src/modules/refunds/refunds.service';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { configurePaymentBodyParsers } from '../src/modules/payments/payment-body-parsers';

const FIXTURE = 'SettlementFixtureBooking';
interface FixtureBooking extends Omit<
  BookingPaymentSnapshot,
  'id' | 'userId' | 'providerId'
> {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  providerId: Types.ObjectId;
  paymentFence: number;
  linkedPaymentId?: string;
  confirmedTransitions: number;
  releasedTransitions: number;
}
const fixtureSchema = new Schema<FixtureBooking>({
  kind: String,
  userId: Schema.Types.ObjectId,
  providerId: Schema.Types.ObjectId,
  state: String,
  revision: String,
  amountMinor: Number,
  currency: String,
  holdExpiresAt: Date,
  policies: Schema.Types.Mixed,
  paymentFence: { type: Number, default: 0 },
  linkedPaymentId: String,
  confirmedTransitions: { type: Number, default: 0 },
  releasedTransitions: { type: Number, default: 0 },
});

// A transaction-capable test adapter, not a flight/hotel implementation.
class SettlementAdapter implements BookingSettlementAdapter {
  constructor(
    readonly kind: BookingKind,
    private readonly bookings: Model<FixtureBooking>,
  ) {}
  private snapshot(booking: FixtureBooking): BookingPaymentSnapshot {
    return {
      ...booking,
      id: booking._id.toString(),
      userId: booking.userId.toString(),
      providerId: booking.providerId.toString(),
    };
  }
  async getOwned(userId: string, bookingId: string) {
    const booking = await this.bookings
      .findOne({ _id: bookingId, userId, kind: this.kind })
      .lean()
      .exec();
    if (!booking) throw new NotFoundException('Booking not found');
    return this.snapshot(booking);
  }
  async getOwnedForUpdate(
    userId: string,
    bookingId: string,
    session: ClientSession,
  ) {
    const booking = await this.bookings
      .findOneAndUpdate(
        { _id: bookingId, userId, kind: this.kind },
        { $inc: { paymentFence: 1 } },
        { session, new: true },
      )
      .lean()
      .exec();
    if (!booking) throw new NotFoundException('Booking not found');
    return this.snapshot(booking);
  }
  async linkPayment(
    userId: string,
    bookingId: string,
    paymentId: string,
    session: ClientSession,
  ) {
    const result = await this.bookings
      .updateOne(
        {
          _id: bookingId,
          userId,
          kind: this.kind,
          state: 'Pending Payment',
          holdExpiresAt: { $gt: new Date() },
          $or: [
            { linkedPaymentId: { $exists: false } },
            { linkedPaymentId: paymentId },
          ],
        },
        { $set: { linkedPaymentId: paymentId } },
        { session },
      )
      .exec();
    if (result.matchedCount !== 1)
      throw new ConflictException('Booking cannot link this payment');
  }
  async confirmPayment(
    userId: string,
    bookingId: string,
    paymentId: string,
    session: ClientSession,
  ): Promise<'Confirmed' | 'Expired'> {
    const booking = await this.bookings
      .findOne({
        _id: bookingId,
        userId,
        kind: this.kind,
        linkedPaymentId: paymentId,
      })
      .session(session)
      .orFail()
      .exec();
    if (booking.state === 'Confirmed') return 'Confirmed';
    if (
      booking.state === 'Expired' ||
      booking.holdExpiresAt.getTime() <= Date.now()
    ) {
      await this.expirePayment(userId, bookingId, paymentId, session);
      return 'Expired';
    }
    if (booking.state !== 'Pending Payment')
      throw new ConflictException('Booking cannot be confirmed');
    await this.bookings
      .updateOne(
        { _id: bookingId, state: 'Pending Payment' },
        { $set: { state: 'Confirmed' }, $inc: { confirmedTransitions: 1 } },
        { session },
      )
      .exec();
    return 'Confirmed';
  }
  async expirePayment(
    userId: string,
    bookingId: string,
    paymentId: string,
    session: ClientSession,
  ) {
    const booking = await this.bookings
      .findOne({
        _id: bookingId,
        userId,
        kind: this.kind,
        linkedPaymentId: paymentId,
      })
      .session(session)
      .orFail()
      .exec();
    if (booking.state === 'Expired') return;
    if (
      booking.state !== 'Pending Payment' ||
      booking.holdExpiresAt.getTime() > Date.now()
    )
      throw new ConflictException('Hold cannot expire yet');
    await this.bookings
      .updateOne(
        { _id: bookingId, state: 'Pending Payment' },
        { $set: { state: 'Expired' }, $inc: { releasedTransitions: 1 } },
        { session },
      )
      .exec();
  }
}

@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: FIXTURE, schema: fixtureSchema }]),
  ],
  exports: [MongooseModule],
})
class FixtureModule {}

@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useValue: new ConfigService({ NODE_ENV: 'test' }),
    },
  ],
  exports: [ConfigService],
})
class TestConfigurationModule {}

const signingSecret = 'whsec_settlementSyntheticOnly';
const verifier = new StripeTestGateway(
  new ConfigService({ STRIPE_WEBHOOK_SECRET: signingSecret }),
  () => {
    throw new Error('No real Stripe client in these tests');
  },
);
const gateway = {
  createIntent: jest.fn<Promise<GatewayIntent>, [PaymentIntentInput]>(),
  retrieveIntent: jest.fn<Promise<GatewayIntent>, [PaymentIntentReference]>(),
  cancelIntent: jest.fn<Promise<GatewayIntent>, [PaymentIntentReference]>(),
  createRefund: jest.fn<Promise<GatewayRefund>, [RefundInput]>(),
  retrieveRefund: jest.fn<Promise<GatewayRefund>, [RefundInput, string]>(),
  verifyWebhook: verifier.verifyWebhook.bind(verifier),
};

// Real feature modules/guards/HTTP/MongoDB. Only external gateway operations and
// missing team adapters use controlled fixtures. Signatures use the official SDK.
describe('Payment settlement (real HTTP/replica set with approved contract fixtures)', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let users: Model<User>;
  let sessions: Model<UserSession>;
  let bookings: Model<FixtureBooking>;
  let payments: Model<Payment>;
  let events: Model<PaymentEvent>;
  let policies: Model<PolicyAcceptance>;
  let refunds: Model<Refund>;
  let outbox: Model<RefundOutbox>;
  let ownerId: string;
  let passwordHash: string;
  const intents = new Map<string, GatewayIntent>();
  const stripeRefunds = new Map<string, GatewayRefund>();
  const adapters: BookingPaymentAdapter[] = [];

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), {
          dbName: 'giu_settlement_tests',
        }),
        FixtureModule,
        PaymentsModule,
      ],
    })
      .overrideProvider(ConfigService)
      .useValue(new ConfigService({ NODE_ENV: 'test' }))
      .overrideProvider(StripeTestGateway)
      .useValue(gateway)
      .overrideProvider(BOOKING_PAYMENT_ADAPTERS)
      .useValue(adapters)
      .compile();
    app = module.createNestApplication({ bodyParser: false });
    configurePaymentBodyParsers(app);
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    app.useGlobalFilters(new HttpErrorFilter());
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder().setTitle('Test API').build(),
      ),
    );
    await app.init();
    connection = app.get(getConnectionToken());
    users = app.get(getModelToken(User.name));
    sessions = app.get(getModelToken(UserSession.name));
    bookings = app.get(getModelToken(FIXTURE));
    payments = app.get(getModelToken(Payment.name));
    events = app.get(getModelToken(PaymentEvent.name));
    policies = app.get(getModelToken(PolicyAcceptance.name));
    refunds = app.get(getModelToken(Refund.name));
    outbox = app.get(getModelToken(RefundOutbox.name));
    await Promise.all([
      users.init(),
      sessions.init(),
      bookings.init(),
      payments.init(),
      events.init(),
      policies.init(),
      refunds.init(),
      outbox.init(),
    ]);
    passwordHash = await hashPassword('test-password1');
  });

  beforeEach(async () => {
    adapters.splice(
      0,
      adapters.length,
      new SettlementAdapter('flight', bookings),
      new SettlementAdapter('hotel', bookings),
    );
    intents.clear();
    stripeRefunds.clear();
    gateway.createIntent.mockReset().mockImplementation(async (input) => {
      const id = `pi_${input.paymentId}`;
      const intent = intents.get(id) ?? {
        id,
        paymentId: input.paymentId,
        amountMinor: input.amountMinor,
        currency: 'USD',
        status: 'requires_payment_method',
        clientSecret: `${id}_secret_synthetic`,
      };
      intents.set(id, intent);
      return { ...intent };
    });
    gateway.retrieveIntent.mockReset().mockImplementation(async (input) => {
      const intent = intents.get(input.intentId);
      if (!intent)
        throw new ServiceUnavailableException('Controlled gateway unavailable');
      if (
        intent.paymentId !== input.paymentId ||
        intent.amountMinor !== input.amountMinor ||
        intent.currency !== input.currency
      )
        throw new BadGatewayException('Controlled gateway mismatch');
      return { ...intent };
    });
    gateway.cancelIntent.mockReset().mockImplementation(async (input) => {
      const intent = intents.get(input.intentId)!;
      if (intent.status === 'succeeded')
        throw new ConflictException('Succeeded payment needs refund');
      const canceled: GatewayIntent = {
        ...intent,
        status: 'canceled',
        clientSecret: null,
      };
      intents.set(canceled.id, canceled);
      return canceled;
    });
    gateway.createRefund.mockReset().mockImplementation(async (input) => {
      const id = `re_${input.refundId}`;
      const refund: GatewayRefund = stripeRefunds.get(id) ?? {
        id,
        intentId: input.intentId,
        amountMinor: input.refundAmountMinor,
        currency: 'USD',
        status: 'Refunded',
      };
      stripeRefunds.set(id, refund);
      return { ...refund };
    });
    gateway.retrieveRefund
      .mockReset()
      .mockImplementation(async (_input, id) => {
        const refund = stripeRefunds.get(id);
        if (!refund)
          throw new ServiceUnavailableException(
            'Controlled refund unavailable',
          );
        return { ...refund };
      });
    await Promise.all([
      users.deleteMany({}),
      sessions.deleteMany({}),
      bookings.deleteMany({}),
      payments.deleteMany({}),
      events.deleteMany({}),
      policies.deleteMany({}),
      refunds.deleteMany({}),
      outbox.deleteMany({}),
    ]);
    ownerId = (
      await users.create({
        email: 'owner@example.com',
        fullName: 'Owner',
        passwordHash,
        preferredCurrency: 'EUR',
      })
    )._id.toString();
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await app?.close();
    await server?.stop();
  });

  async function signIn(email = 'owner@example.com') {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/login')
      .send({ email, password: 'test-password1' })
      .expect(200);
    return agent;
  }
  async function booking(kind: BookingKind = 'flight') {
    return bookings.create({
      kind,
      userId: new Types.ObjectId(ownerId),
      providerId: new Types.ObjectId(),
      state: 'Pending Payment',
      revision: 'fixed-quote',
      amountMinor: 10000,
      currency: 'USD',
      holdExpiresAt: new Date(Date.now() + 600000),
      policies:
        kind === 'flight'
          ? {
              type: 'flight',
              cancellation: [{ daysBefore: 0, refundPercent: 25 }],
              baggage: [
                {
                  segmentId: 'one',
                  cabin: 'Economy',
                  freeBagCount: 1,
                  maxWeightKg: 23,
                  extraBagPriceMinor: 1000,
                  maxExtraBags: 2,
                },
              ],
            }
          : {
              type: 'hotel',
              cancellation: [{ daysBefore: 0, refundPercent: 25 }],
              checkInTime: '14:00',
              checkOutTime: '11:00',
            },
    });
  }
  async function acceptedBooking(
    agent: Awaited<ReturnType<typeof signIn>>,
    kind: BookingKind = 'flight',
  ) {
    const target = await booking(kind);
    const url = `/api/bookings/${kind}/${target._id}`;
    const review = (await agent.get(`${url}/policies`).expect(200)).body;
    await agent
      .post(`${url}/accept-policies`)
      .send({ accepted: true, policyToken: review.policyToken })
      .expect(200);
    return target;
  }
  async function initiate(
    agent: Awaited<ReturnType<typeof signIn>>,
    kind: BookingKind = 'flight',
  ) {
    const target = await acceptedBooking(agent, kind);
    const response = await agent
      .post('/api/payments')
      .send({ bookingType: kind, bookingId: target._id.toString() })
      .expect(201);
    return {
      target,
      payment: response.body.payment,
      clientSecret: response.body.clientSecret as string,
    };
  }
  function signedEvent(
    payment: { id: string; stripePaymentId: string },
    overrides: Record<string, unknown> = {},
  ) {
    const body = {
      id: `evt_${new Types.ObjectId()}`,
      object: 'event',
      type: 'payment_intent.succeeded',
      livemode: false,
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: payment.stripePaymentId,
          object: 'payment_intent',
          metadata: { payment_id: payment.id },
        },
      },
      ...overrides,
    };
    const payload = JSON.stringify(body);
    return {
      body,
      payload,
      signature: Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: signingSecret,
      }),
    };
  }
  function deliver(event: ReturnType<typeof signedEvent>) {
    return request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', event.signature)
      .send(event.payload);
  }
  function paid(id: string) {
    const intent = intents.get(id)!;
    intents.set(id, { ...intent, status: 'succeeded' });
  }
  function advancePastHold() {
    jest.useFakeTimers({
      doNotFake: [
        'nextTick',
        'setImmediate',
        'clearImmediate',
        'setTimeout',
        'clearTimeout',
        'setInterval',
        'clearInterval',
        'performance',
        'hrtime',
        'queueMicrotask',
      ],
    });
    jest.setSystemTime(Date.now() + 11 * 60000);
  }

  it.each(['flight', 'hotel'] as BookingKind[])(
    'creates a policy-bound USD %s payment without confirming or storing secrets',
    async (kind) => {
      const agent = await signIn();
      const { target, payment, clientSecret } = await initiate(agent, kind);
      expect(payment).toMatchObject({
        bookingType: kind,
        amountMinor: 10000,
        currency: 'USD',
        fulfillment: 'pending',
        status: 'requires_payment_method',
      });
      expect(clientSecret).toContain('_secret_');
      const stored = await payments.findById(payment.id).orFail().lean();
      expect(JSON.stringify(stored)).not.toContain('_secret_');
      expect(stored.policies).toEqual(
        (await policies.findOne().orFail()).policies,
      );
      expect((await bookings.findById(target._id).orFail()).state).toBe(
        'Pending Payment',
      );
      const view = await agent.get(`/api/payments/${payment.id}`).expect(200);
      expect(JSON.stringify(view.body)).not.toContain('_secret_');
      expect(view.headers['cache-control']).toBe('no-store');
    },
  );

  it('blocks payment before policy acceptance and after a stale policy edit with no gateway call', async () => {
    const agent = await signIn();
    const target = await booking();
    await agent
      .post('/api/payments')
      .send({ bookingType: 'flight', bookingId: target._id.toString() })
      .expect(409);
    expect(await payments.countDocuments()).toBe(0);
    expect(gateway.createIntent).not.toHaveBeenCalled();
    const accepted = await acceptedBooking(agent);
    await bookings.updateOne(
      { _id: accepted._id },
      { $set: { amountMinor: 20000 } },
    );
    await agent
      .post('/api/payments')
      .send({ bookingType: 'flight', bookingId: accepted._id.toString() })
      .expect(409);
    expect(gateway.createIntent).not.toHaveBeenCalled();
  });

  it('reuses one payment/intent across initiation and retries', async () => {
    const agent = await signIn();
    const { target, payment } = await initiate(agent);
    const repeated = await agent
      .post('/api/payments')
      .send({ bookingType: 'flight', bookingId: target._id.toString() })
      .expect(201);
    const retried = await agent
      .post(`/api/payments/${payment.id}/retry`)
      .send({})
      .expect(200);
    expect(repeated.body.payment.id).toBe(payment.id);
    expect(retried.body.payment.stripePaymentId).toBe(payment.stripePaymentId);
    expect(await payments.countDocuments()).toBe(1);
    expect(intents.size).toBe(1);
    expect(gateway.createIntent).toHaveBeenCalledTimes(1);
  });

  it('retains a durable operation identity after a lost create response', async () => {
    const agent = await signIn();
    const target = await acceptedBooking(agent);
    const normal = gateway.createIntent.getMockImplementation()!;
    gateway.createIntent.mockImplementationOnce(async (input) => {
      await normal(input);
      throw new ServiceUnavailableException('Uncertain controlled response');
    });
    await agent
      .post('/api/payments')
      .send({ bookingType: 'flight', bookingId: target._id.toString() })
      .expect(503);
    const original = await payments.findOne().orFail();
    const recovered = await agent
      .post('/api/payments')
      .send({ bookingType: 'flight', bookingId: target._id.toString() })
      .expect(201);
    expect(recovered.body.payment.id).toBe(original._id.toString());
    expect(intents.size).toBe(1);
    expect(gateway.createIntent.mock.calls[0][0].paymentId).toBe(
      gateway.createIntent.mock.calls[1][0].paymentId,
    );
  });

  it('confirms only after a signed event and matching succeeded intent, once across duplicate/ordered deliveries', async () => {
    const agent = await signIn();
    const { target, payment } = await initiate(agent);
    await deliver(signedEvent(payment)).expect(200);
    expect((await bookings.findById(target._id).orFail()).state).toBe(
      'Pending Payment',
    );
    paid(payment.stripePaymentId);
    const succeeded = signedEvent(payment);
    await deliver(succeeded).expect(200);
    await deliver(succeeded).expect(200);
    await deliver(
      signedEvent(payment, { type: 'payment_intent.processing' }),
    ).expect(200);
    const stored = await bookings.findById(target._id).orFail();
    expect(stored.state).toBe('Confirmed');
    expect(stored.confirmedTransitions).toBe(1);
    expect((await payments.findById(payment.id).orFail()).fulfillment).toBe(
      'confirmed',
    );
    expect(await refunds.countDocuments()).toBe(0);
  });

  it('rejects unsigned, altered, live and malformed raw webhook deliveries before persistence', async () => {
    const agent = await signIn();
    const { payment } = await initiate(agent);
    const event = signedEvent(payment);
    await request(app.getHttpServer())
      .post('/api/payments/webhook')
      .send(event.body)
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', event.signature)
      .send(event.payload + ' ')
      .expect(400);
    await deliver(signedEvent(payment, { livemode: true })).expect(400);
    const payload = '{invalid json';
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: signingSecret,
    });
    await request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(payload)
      .expect(400);
    expect(await events.countDocuments()).toBe(0);
  });

  it('rejects event-ID payload substitution and ignores unrelated signed events', async () => {
    const agent = await signIn();
    const { payment } = await initiate(agent);
    const event = signedEvent(payment);
    await deliver(event).expect(200);
    await deliver(
      signedEvent(payment, {
        id: event.body.id,
        type: 'payment_intent.processing',
      }),
    ).expect(400);
    await deliver(
      signedEvent(payment, {
        type: 'customer.created',
        data: { object: { object: 'customer', id: 'cus_fixture' } },
      }),
    ).expect(200);
    expect(await events.countDocuments({ status: 'ignored' })).toBe(1);
  });

  it('rolls back booking confirmation on persistence failure and recovers the pending event', async () => {
    const agent = await signIn();
    const { target, payment } = await initiate(agent);
    paid(payment.stripePaymentId);
    const event = signedEvent(payment);
    const write = jest.spyOn(events, 'updateOne').mockImplementationOnce(() => {
      throw new Error('Simulated event commit failure');
    });
    await deliver(event).expect(500);
    expect(
      (await bookings.findById(target._id).orFail()).confirmedTransitions,
    ).toBe(0);
    expect((await payments.findById(payment.id).orFail()).fulfillment).toBe(
      'pending',
    );
    expect((await events.findOne().orFail()).status).toBe('pending');
    write.mockRestore();
    await deliver(event).expect(200);
    expect(
      (await bookings.findById(target._id).orFail()).confirmedTransitions,
    ).toBe(1);
  });

  it('expires unpaid holds and cancels their intents once', async () => {
    const agent = await signIn();
    const { target, payment } = await initiate(agent);
    advancePastHold();
    await app.get(PaymentsService).runDue();
    await app.get(PaymentsService).runDue();
    const expired = await bookings.findById(target._id).orFail();
    expect(expired.state).toBe('Expired');
    expect(expired.releasedTransitions).toBe(1);
    expect(intents.get(payment.stripePaymentId)?.status).toBe('canceled');
    expect(gateway.cancelIntent).toHaveBeenCalledTimes(1);
    expect(
      (await payments.findById(payment.id).orFail()).expiryResolvedAt,
    ).toBeInstanceOf(Date);
  });

  it('persists and executes the delegated full refund for an unfulfillable late success', async () => {
    const agent = await signIn();
    const { target, payment } = await initiate(agent);
    advancePastHold();
    paid(payment.stripePaymentId);
    const event = signedEvent(payment);
    await deliver(event).expect(200);
    await deliver(event).expect(200);
    const expired = await bookings.findById(target._id).orFail();
    expect(expired.state).toBe('Expired');
    expect(expired.confirmedTransitions).toBe(0);
    expect(expired.releasedTransitions).toBe(1);
    const refund = await refunds.findOne().orFail();
    expect(refund.amountMinor).toBe(10000);
    expect(refund.reason).toBe('late_payment');
    await app.get(RefundsService).runDue();
    await app.get(RefundsService).runDue();
    expect((await refunds.findById(refund._id).orFail()).status).toBe(
      'Refunded',
    );
    expect(stripeRefunds.size).toBe(1);
    expect(
      await outbox.countDocuments({
        'payload.refundStatus': 'Refunded',
        status: 'pending',
      }),
    ).toBe(1);
    await agent.post('/api/auth/refresh').expect(200);
    expect(
      (await agent.get(`/api/refunds/${refund._id}`).expect(200)).body,
    ).toMatchObject({
      amountMinor: 10000,
      currency: 'USD',
      status: 'Refunded',
    });
  });

  it('keeps refund retries pending after a temporary failure with one logical refund identity', async () => {
    const agent = await signIn();
    const { payment } = await initiate(agent);
    advancePastHold();
    paid(payment.stripePaymentId);
    await deliver(signedEvent(payment)).expect(200);
    const refund = await refunds.findOne().orFail();
    gateway.createRefund.mockRejectedValueOnce(
      new ServiceUnavailableException('Temporary controlled outage'),
    );
    await app.get(RefundsService).runDue();
    expect((await refunds.findById(refund._id).orFail()).status).toBe(
      'Pending',
    );
    await refunds.updateOne(
      { _id: refund._id },
      { $set: { nextAttemptAt: new Date(0) } },
    );
    await app.get(RefundsService).runDue();
    expect(stripeRefunds.size).toBe(1);
    expect(gateway.createRefund.mock.calls[0][0].refundId).toBe(
      gateway.createRefund.mock.calls[1][0].refundId,
    );
  });

  it('supports an authorized cancellation refund transaction and prevents changed/repeated authorizations', async () => {
    const agent = await signIn();
    const { payment } = await initiate(agent);
    paid(payment.stripePaymentId);
    await deliver(signedEvent(payment)).expect(200);
    const service = app.get(RefundsService);
    const input = {
      paymentId: payment.id,
      bookingId: payment.bookingId,
      userId: ownerId,
      amountMinor: 2500,
      reason: 'user_cancellation' as const,
    };
    await connection.transaction(async (session) => {
      await bookings.updateOne(
        { _id: payment.bookingId },
        { $set: { state: 'Cancelled' } },
        { session },
      );
      await service.enqueueCancellation(input, session);
    });
    await connection.transaction(async (session) => {
      await service.enqueueCancellation(input, session);
    });
    expect(await refunds.countDocuments()).toBe(1);
    await expect(
      connection.transaction((session) =>
        service.enqueueCancellation({ ...input, amountMinor: 10000 }, session),
      ),
    ).rejects.toMatchObject({ status: 409 });
    await service.runDue();
    expect((await refunds.findOne().orFail()).status).toBe('Refunded');
  });

  it('requires full provider refunds and omits zero user refunds', async () => {
    const agent = await signIn();
    const { payment } = await initiate(agent);
    paid(payment.stripePaymentId);
    await deliver(signedEvent(payment)).expect(200);
    const service = app.get(RefundsService);
    const input = {
      paymentId: payment.id,
      bookingId: payment.bookingId,
      userId: ownerId,
      amountMinor: 1000,
      reason: 'provider_cancellation' as const,
    };
    await expect(
      connection.transaction((session) =>
        service.enqueueCancellation(input, session),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await connection.transaction(async (session) => {
      expect(
        await service.enqueueCancellation(
          { ...input, amountMinor: 0, reason: 'user_cancellation' },
          session,
        ),
      ).toBeNull();
    });
    expect(await refunds.countDocuments()).toBe(0);
    await connection.transaction((session) =>
      service.enqueueCancellation({ ...input, amountMinor: 10000 }, session),
    );
    expect((await refunds.findOne().orFail()).amountMinor).toBe(10000);
  });

  it('denies guest, foreign-owner, restricted-session and injected payment fields', async () => {
    const agent = await signIn();
    const { payment } = await initiate(agent);
    await request(app.getHttpServer())
      .get(`/api/payments/${payment.id}`)
      .expect(401);
    await users.create({
      email: 'other@example.com',
      fullName: 'Other',
      passwordHash,
    });
    const other = await signIn('other@example.com');
    await other.get(`/api/payments/${payment.id}`).expect(404);
    await other.post(`/api/payments/${payment.id}/retry`).send({}).expect(404);
    await other
      .post('/api/payments')
      .send({ bookingType: 'flight', bookingId: payment.bookingId })
      .expect(404);
    await agent
      .post(`/api/payments/${payment.id}/retry`)
      .send({ amountMinor: 1 })
      .expect(400);
    await agent
      .post('/api/payments')
      .send({
        bookingType: 'flight',
        bookingId: payment.bookingId,
        amountMinor: 1,
        userId: ownerId,
      })
      .expect(400);
    await users.updateOne(
      { _id: ownerId },
      { $set: { mustChangePassword: true } },
    );
    await agent.get(`/api/payments/${payment.id}`).expect(403);
  });

  it.each(['admin', 'airline_moderator', 'hotel_moderator'] as UserRole[])(
    'denies payment authoring to a staff-only %s',
    async (role) => {
      await users.updateOne({ _id: ownerId }, { $set: { roles: [role] } });
      const agent = await signIn();
      await agent
        .post('/api/payments')
        .send({
          bookingType: 'flight',
          bookingId: new Types.ObjectId().toString(),
        })
        .expect(403);
    },
  );

  it('serializes concurrent initiation and recovers without a second payment or intent', async () => {
    const agent = await signIn();
    const target = await acceptedBooking(agent);
    const normal = gateway.createIntent.getMockImplementation()!;
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    gateway.createIntent.mockImplementationOnce(async (input) => {
      entered();
      await held;
      return normal(input);
    });
    const body = { bookingType: 'flight', bookingId: target._id.toString() };
    const first = agent
      .post('/api/payments')
      .send(body)
      .then((response) => response);
    await started;
    try {
      await agent.post('/api/payments').send(body).expect(409);
    } finally {
      release();
    }
    expect((await first).status).toBe(201);
    await agent.post('/api/payments').send(body).expect(201);
    expect(await payments.countDocuments()).toBe(1);
    expect(gateway.createIntent).toHaveBeenCalledTimes(1);
    expect(intents.size).toBe(1);
  });

  it('rejects a mismatched authoritative amount without confirming and permits verified redelivery', async () => {
    const agent = await signIn();
    const { target, payment } = await initiate(agent);
    const correct = intents.get(payment.stripePaymentId)!;
    intents.set(correct.id, {
      ...correct,
      amountMinor: 1,
      status: 'succeeded',
    });
    const event = signedEvent(payment);
    await deliver(event).expect(502);
    expect((await bookings.findById(target._id).orFail()).state).toBe(
      'Pending Payment',
    );
    expect((await events.findOne().orFail()).status).toBe('pending');
    intents.set(correct.id, { ...correct, status: 'succeeded' });
    await deliver(event).expect(200);
    expect(
      (await bookings.findById(target._id).orFail()).confirmedTransitions,
    ).toBe(1);
  });

  it('rejects a partial booking integration before creating a charge', async () => {
    const agent = await signIn();
    const target = await acceptedBooking(agent);
    const fixture = new SettlementAdapter('flight', bookings);
    adapters.splice(0, adapters.length, {
      kind: 'flight',
      getOwned: fixture.getOwned.bind(fixture),
      getOwnedForUpdate: fixture.getOwnedForUpdate.bind(fixture),
    });
    await agent
      .post('/api/payments')
      .send({ bookingType: 'flight', bookingId: target._id.toString() })
      .expect(503);
    expect(await payments.countDocuments()).toBe(0);
    expect(gateway.createIntent).not.toHaveBeenCalled();
  });

  it('rolls back cancellation and refund reservation when the notification outbox cannot persist', async () => {
    const agent = await signIn();
    const { target, payment } = await initiate(agent);
    paid(payment.stripePaymentId);
    await deliver(signedEvent(payment)).expect(200);
    jest.spyOn(outbox, 'updateOne').mockImplementationOnce(() => {
      throw new Error('Controlled outbox failure');
    });
    await expect(
      connection.transaction(async (session) => {
        await bookings.updateOne(
          { _id: target._id },
          { $set: { state: 'Cancelled' } },
          { session },
        );
        await app.get(RefundsService).enqueueCancellation(
          {
            paymentId: payment.id,
            bookingId: payment.bookingId,
            userId: ownerId,
            amountMinor: 2500,
            reason: 'user_cancellation',
          },
          session,
        );
      }),
    ).rejects.toThrow('Controlled outbox failure');
    expect((await bookings.findById(target._id).orFail()).state).toBe(
      'Confirmed',
    );
    expect(await refunds.countDocuments()).toBe(0);
    expect(await outbox.countDocuments()).toBe(0);
  });

  it('reconciles pending refunds through signed events without duplicate status notifications', async () => {
    const agent = await signIn();
    const { payment } = await initiate(agent);
    advancePastHold();
    paid(payment.stripePaymentId);
    await deliver(signedEvent(payment)).expect(200);
    const normal = gateway.createRefund.getMockImplementation()!;
    gateway.createRefund.mockImplementationOnce(async (input) => {
      const result = { ...(await normal(input)), status: 'Pending' as const };
      stripeRefunds.set(result.id, result);
      return result;
    });
    await app.get(RefundsService).runDue();
    const refund = await refunds.findOne().orFail();
    const result = stripeRefunds.get(refund.stripeRefundId!)!;
    stripeRefunds.set(result.id, { ...result, status: 'Refunded' });
    const event = signedEvent(payment, {
      type: 'refund.updated',
      data: {
        object: {
          id: result.id,
          object: 'refund',
          metadata: { refund_id: refund._id.toString() },
        },
      },
    });
    await deliver(event).expect(200);
    await deliver(event).expect(200);
    expect((await refunds.findById(refund._id).orFail()).status).toBe(
      'Refunded',
    );
    expect(
      await outbox.countDocuments({ 'payload.refundStatus': 'Refunded' }),
    ).toBe(1);
    expect(gateway.createRefund).toHaveBeenCalledTimes(1);
  });

  it('compensates exactly once when webhook retrieval races the hold-expiry worker', async () => {
    const agent = await signIn();
    const { target, payment } = await initiate(agent);
    advancePastHold();
    jest.setSystemTime(target.holdExpiresAt.getTime() - 1000);
    paid(payment.stripePaymentId);
    const normal = gateway.retrieveIntent.getMockImplementation()!;
    let release!: () => void;
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    gateway.retrieveIntent.mockImplementationOnce(async (input) => {
      entered();
      await held;
      return normal(input);
    });
    const event = signedEvent(payment);
    const processing = deliver(event).then((response) => response);
    await started;
    jest.setSystemTime(target.holdExpiresAt.getTime() + 1000);
    try {
      await app.get(PaymentsService).runDue();
    } finally {
      release();
    }
    expect((await processing).status).toBe(200);
    await app.get(PaymentsService).runDue();
    // A freshly signed redelivery preserves the event's durable identity.
    await deliver(signedEvent(payment, event.body)).expect(200);
    const stored = await bookings.findById(target._id).orFail();
    expect(stored.state).toBe('Expired');
    expect(stored.confirmedTransitions).toBe(0);
    expect(stored.releasedTransitions).toBe(1);
    expect(await refunds.countDocuments()).toBe(1);
    await app.get(RefundsService).runDue();
    expect(stripeRefunds.size).toBe(1);
    expect((await refunds.findOne().orFail()).amountMinor).toBe(10000);
  });

  it('publishes owner response schemas and signed raw-body webhook documentation', async () => {
    const document = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    expect(document.paths['/api/payments'].post.responses['201']).toBeDefined();
    expect(
      document.paths['/api/payments/webhook'].post.security,
    ).toBeUndefined();
    expect(
      document.components.schemas.PaymentViewDto.properties,
    ).not.toHaveProperty('clientSecret');
    expect(
      document.paths['/api/refunds/{id}'].get.responses['200'],
    ).toBeDefined();
  });
});
