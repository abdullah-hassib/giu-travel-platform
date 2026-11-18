import {
  ConflictException,
  Global,
  INestApplication,
  Module,
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
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { Connection, Model, Types } from 'mongoose';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Stripe from 'stripe';
import request from 'supertest';
import { OutboxEvent } from '../src/common/events/outbox-event.schema';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { AdministrationModule } from '../src/modules/administration/administration.module';
import { hashPassword } from '../src/modules/auth/security/password';
import { UserSession } from '../src/modules/auth/schemas/user-session.schema';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { HotelBooking } from '../src/modules/hotel-bookings/schemas/hotel-booking.schema';
import { addDays, todayUtc } from '../src/modules/hotels/stay-rules';
import { configurePaymentBodyParsers } from '../src/modules/payments/payment-body-parsers';
import { PaymentsModule } from '../src/modules/payments/payments.module';
import { Payment } from '../src/modules/payments/schemas/payment.schema';
import {
  GatewayIntent,
  GatewayRefund,
  PaymentIntentInput,
  PaymentIntentReference,
  RefundInput,
  StripeTestGateway,
} from '../src/modules/payments/stripe-test.gateway';
import { RefundsService } from '../src/modules/refunds/refunds.service';
import { Refund } from '../src/modules/refunds/schemas/refund.schema';
import { User } from '../src/modules/users/schemas/user.schema';

const uploadDir = mkdtempSync(join(tmpdir(), 'giu-hotel-payment-media-'));
const signingSecret = 'whsec_hotelIntegrationSyntheticOnly';
const verifier = new StripeTestGateway(
  new ConfigService({ STRIPE_WEBHOOK_SECRET: signingSecret }),
  () => {
    throw new Error('External network disabled in this suite');
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

@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useValue: new ConfigService({
        NODE_ENV: 'test',
        MEDIA_UPLOAD_DIR: uploadDir,
      }),
    },
  ],
  exports: [ConfigService],
})
class TestConfigurationModule {}

type Agent = ReturnType<typeof request.agent>;
interface PaymentView {
  id: string;
  stripePaymentId: string;
}
const day = (offset: number) => addDays(todayUtc(), offset);

// Actual administration/provider/payment/booking/refund implementations and
// transactions. Only external Stripe requests are controlled; SDK signatures are real.
describe('MK hotels with Hassib administration, payments and refunds', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let users: Model<User>;
  let sessions: Model<UserSession>;
  let bookings: Model<HotelBooking>;
  let payments: Model<Payment>;
  let refunds: Model<Refund>;
  let outbox: Model<OutboxEvent>;
  let passwordHash: string;
  let admin: Agent;
  let moderator: Agent;
  let traveler: Agent;
  let otherTraveler: Agent;
  let hotelId: string;
  let roomId: string;
  const intents = new Map<string, GatewayIntent>();

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), {
          dbName: 'giu_real_hotel_integration',
        }),
        AdministrationModule,
        PaymentsModule,
      ],
    })
      .overrideProvider(StripeTestGateway)
      .useValue(gateway)
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
    await app.init();
    connection = app.get(getConnectionToken());
    users = app.get(getModelToken(User.name));
    sessions = app.get(getModelToken(UserSession.name));
    bookings = app.get(getModelToken(HotelBooking.name));
    payments = app.get(getModelToken(Payment.name));
    refunds = app.get(getModelToken(Refund.name));
    outbox = app.get(getModelToken(OutboxEvent.name));
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    passwordHash = await hashPassword('test-password1');
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    intents.clear();
    gateway.createIntent.mockImplementation(async (input) => {
      const id = `pi_${input.paymentId}`;
      const intent: GatewayIntent = intents.get(id) ?? {
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
    gateway.retrieveIntent.mockImplementation(async (input) => {
      const intent = intents.get(input.intentId);
      if (!intent)
        throw new ServiceUnavailableException('Controlled gateway unavailable');
      expect(intent).toMatchObject({
        paymentId: input.paymentId,
        amountMinor: input.amountMinor,
        currency: input.currency,
      });
      return { ...intent };
    });
    gateway.cancelIntent.mockImplementation(async (input) => {
      const intent = intents.get(input.intentId)!;
      if (intent.status === 'succeeded')
        throw new ConflictException('Succeeded payment needs refund');
      const cancelled: GatewayIntent = {
        ...intent,
        status: 'canceled',
        clientSecret: null,
      };
      intents.set(cancelled.id, cancelled);
      return cancelled;
    });
    gateway.createRefund.mockImplementation(async (input) => ({
      id: `re_${input.refundId}`,
      intentId: input.intentId,
      amountMinor: input.refundAmountMinor,
      currency: 'USD',
      status: 'Refunded',
    }));
    gateway.retrieveRefund.mockImplementation(async (input, id) => ({
      id,
      intentId: input.intentId,
      amountMinor: input.refundAmountMinor,
      currency: 'USD',
      status: 'Refunded',
    }));
    await Promise.all(
      Object.values(connection.collections).map((collection) =>
        collection.deleteMany({}),
      ),
    );
    await users.create([
      {
        email: 'admin@example.com',
        fullName: 'Admin',
        roles: ['admin'],
        passwordHash,
      },
      { email: 'owner@example.com', fullName: 'Owner', passwordHash },
      { email: 'other@example.com', fullName: 'Other', passwordHash },
    ]);
    admin = await signIn('admin@example.com');
    traveler = await signIn('owner@example.com');
    otherTraveler = await signIn('other@example.com');
    hotelId = (
      await admin
        .post('/api/hotels')
        .send({
          name: 'Integration Hotel',
          address: '1 Corniche',
          cityId: 'cairo',
          countryCode: 'EG',
          starRating: 4,
          amenities: [],
        })
        .expect(201)
    ).body.id;
    await admin
      .post('/api/admin/moderators')
      .send({
        email: 'mod@example.com',
        fullName: 'Real Hotel Moderator',
        password: 'temporary-password1',
        role: 'hotel_moderator',
        providerId: hotelId,
      })
      .expect(201);
    moderator = await signIn('mod@example.com', 'temporary-password1');
    await moderator
      .patch(`/api/hotels/${hotelId}`)
      .send({ description: 'Restricted' })
      .expect(403);
    await moderator
      .patch('/api/auth/change-password')
      .send({
        currentPassword: 'temporary-password1',
        newPassword: 'changed-password2',
      })
      .expect(204);
    moderator = await signIn('mod@example.com', 'changed-password2');
    await moderator
      .put(`/api/hotels/${hotelId}/policies`)
      .send({
        checkInTime: '14:00',
        checkOutTime: '11:00',
        cancellationTiers: [{ daysBefore: 0, refundPercent: 25 }],
      })
      .expect(200);
    roomId = (
      await moderator
        .post(`/api/hotels/${hotelId}/rooms`)
        .send({
          name: 'Integration Room',
          type: 'Double',
          beds: 1,
          maxOccupancy: 2,
          pricePerNightMinor: 10_000,
        })
        .expect(201)
    ).body.id;
    await moderator
      .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
      .send({ from: day(0), to: day(60) })
      .expect(201);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await app?.close();
    await server?.stop();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  async function signIn(email: string, password = 'test-password1') {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password }).expect(200);
    return agent;
  }
  function hold(agent = traveler) {
    return agent.post('/api/hotel-bookings').send({
      hotelId,
      checkIn: day(5),
      checkOut: day(8),
      rooms: [{ roomId, adults: 1 }],
    });
  }
  async function initiate() {
    const bookingId: string = (await hold().expect(201)).body.id;
    const path = `/api/bookings/hotel/${bookingId}`;
    const review = (await traveler.get(`${path}/policies`).expect(200)).body;
    await traveler
      .post(`${path}/accept-policies`)
      .send({
        accepted: true,
        policyToken: review.policyToken,
      })
      .expect(200);
    const payment: PaymentView = (
      await traveler
        .post('/api/payments')
        .send({
          bookingType: 'hotel',
          bookingId,
        })
        .expect(201)
    ).body.payment;
    return { bookingId, payment };
  }
  function event(payment: PaymentView) {
    const payload = JSON.stringify({
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
    });
    const signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: signingSecret,
    });
    return { payload, signature };
  }
  function deliver(message: ReturnType<typeof event>) {
    return request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', message.signature)
      .send(message.payload);
  }
  async function settle(payment: PaymentView) {
    intents.set(payment.stripePaymentId, {
      ...intents.get(payment.stripePaymentId)!,
      status: 'succeeded',
    });
    const message = event(payment);
    await deliver(message).expect(200);
    return message;
  }

  function advanceTime(milliseconds: number) {
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
    jest.setSystemTime(Date.now() + milliseconds);
  }

  it('creates a real provider assignment and enforces its boundary after the password change', async () => {
    const otherHotel = (
      await admin
        .post('/api/hotels')
        .send({
          name: 'Other Hotel',
          address: '2 Corniche',
          cityId: 'cairo',
          countryCode: 'EG',
          starRating: 3,
        })
        .expect(201)
    ).body.id;
    await moderator
      .patch(`/api/hotels/${hotelId}`)
      .send({ description: 'Allowed' })
      .expect(200);
    await moderator
      .patch(`/api/hotels/${otherHotel}`)
      .send({ description: 'Denied' })
      .expect(403);
    await admin
      .post('/api/admin/moderators')
      .send({
        email: 'missing@example.com',
        fullName: 'Missing Provider',
        password: 'temporary-password1',
        role: 'hotel_moderator',
        providerId: new Types.ObjectId().toString(),
      })
      .expect(404);
    expect(await users.countDocuments({ email: 'missing@example.com' })).toBe(
      0,
    );
  });

  it('requires policy acceptance and a verified webhook, then confirms once and retains inventory', async () => {
    const { bookingId, payment } = await initiate();
    expect(await bookings.findById(bookingId).lean()).toMatchObject({
      status: 'Pending Payment',
      paymentId: payment.id,
    });
    await otherTraveler
      .get(`/api/bookings/hotel/${bookingId}/policies`)
      .expect(404);
    await otherTraveler.get(`/api/payments/${payment.id}`).expect(404);
    const message = event(payment);
    await deliver({ ...message, signature: 'invalid' }).expect(400);
    expect((await bookings.findById(bookingId).orFail()).status).toBe(
      'Pending Payment',
    );
    const success = await settle(payment);
    await deliver(success).expect(200);
    const stored = await bookings.findById(bookingId).orFail();
    expect(stored.status).toBe('Confirmed');
    expect(stored.reference).toMatch(/^HTL-[A-F0-9]{8}$/);
    expect(stored.totalMinor).toBe(30_000);
    expect(
      await outbox.countDocuments({ type: 'hotel_booking.confirmed' }),
    ).toBe(1);
    expect(await payments.findById(payment.id).lean()).toMatchObject({
      status: 'succeeded',
      fulfillment: 'confirmed',
      amountMinor: 30_000,
      currency: 'USD',
    });
    await hold(otherTraveler).expect(409);
  });

  it('rejects initiating a real booking payment before its owner accepts policies', async () => {
    const bookingId = (await hold().expect(201)).body.id;
    await traveler
      .post('/api/payments')
      .send({ bookingType: 'hotel', bookingId })
      .expect(409);
    expect(await payments.countDocuments()).toBe(0);
    expect(gateway.createIntent).not.toHaveBeenCalled();
  });

  it('cancels atomically with a single real refund using saved policies and releases the room', async () => {
    const { bookingId, payment } = await initiate();
    await settle(payment);
    await moderator
      .put(`/api/hotels/${hotelId}/policies`)
      .send({
        checkInTime: '15:00',
        checkOutTime: '12:00',
        cancellationTiers: [{ daysBefore: 0, refundPercent: 100 }],
      })
      .expect(200);
    await otherTraveler
      .post(`/api/hotel-bookings/${bookingId}/cancel`)
      .expect(404);
    await traveler.post(`/api/hotel-bookings/${bookingId}/cancel`).expect(200);
    await traveler.post(`/api/hotel-bookings/${bookingId}/cancel`).expect(409);
    const refund = await refunds.findOne({ paymentId: payment.id }).orFail();
    expect(refund).toMatchObject({
      amountMinor: 7500,
      currency: 'USD',
      reason: 'user_cancellation',
      status: 'Pending',
    });
    expect(await refunds.countDocuments()).toBe(1);
    expect(
      await outbox.countDocuments({ type: 'hotel_booking.cancelled' }),
    ).toBe(1);
    await app.get(RefundsService).runDue();
    await traveler
      .get(`/api/refunds/${refund._id}`)
      .expect(200)
      .expect((response) => {
        expect(response.body).toMatchObject({
          status: 'Refunded',
          amountMinor: 7500,
        });
      });
    await otherTraveler.get(`/api/refunds/${refund._id}`).expect(404);
    expect(gateway.createRefund).toHaveBeenCalledTimes(1);
    await hold(otherTraveler).expect(201);
  });

  it('rolls back cancellation and its event if the real refund reservation cannot commit', async () => {
    const { bookingId, payment } = await initiate();
    await settle(payment);
    const failure = jest
      .spyOn(app.get(RefundsService), 'enqueueCancellation')
      .mockRejectedValueOnce(
        new ConflictException('Injected reservation failure'),
      );
    await traveler.post(`/api/hotel-bookings/${bookingId}/cancel`).expect(409);
    expect((await bookings.findById(bookingId).orFail()).status).toBe(
      'Confirmed',
    );
    expect(await refunds.countDocuments()).toBe(0);
    expect(
      await outbox.countDocuments({ type: 'hotel_booking.cancelled' }),
    ).toBe(0);
    await hold(otherTraveler).expect(409);
    failure.mockRestore();
    await traveler.post(`/api/hotel-bookings/${bookingId}/cancel`).expect(200);
    expect(await refunds.countDocuments()).toBe(1);
  });

  it('refunds a late success without confirming an expired hold over a replacement booking', async () => {
    const { bookingId, payment } = await initiate();
    // Let the immutable hold lapse; editing its deadline would correctly fail
    // the signed quote check and would not represent a real late payment.
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
    jest.setSystemTime(Date.now() + 11 * 60_000);
    otherTraveler = await signIn('other@example.com');
    const replacementId = (await hold(otherTraveler).expect(201)).body.id;
    const success = await settle(payment);
    await deliver(success).expect(200);
    expect((await bookings.findById(bookingId).orFail()).status).toBe(
      'Expired',
    );
    expect((await bookings.findById(replacementId).orFail()).status).toBe(
      'Pending Payment',
    );
    expect(
      await refunds.findOne({ paymentId: payment.id }).lean(),
    ).toMatchObject({
      amountMinor: 30_000,
      reason: 'late_payment',
    });
    expect(await refunds.countDocuments()).toBe(1);
    expect(
      await outbox.countDocuments({ type: 'hotel_booking.confirmed' }),
    ).toBe(0);
    traveler = await signIn('owner@example.com');
    await hold().expect(409);
  });

  it('deactivates the real provider without invalidating its paid reservations', async () => {
    const { bookingId, payment } = await initiate();
    await settle(payment);
    await admin
      .patch(`/api/admin/providers/hotel/${hotelId}/deactivate`)
      .send({})
      .expect(204);
    expect(
      (await traveler.get(`/api/hotel-bookings/${bookingId}`).expect(200)).body
        .status,
    ).toBe('Confirmed');
    await hold(otherTraveler).expect(404);
    await traveler.post(`/api/hotel-bookings/${bookingId}/cancel`).expect(200);
    expect(await refunds.countDocuments()).toBe(1);
  });

  it('makes admin hotel status commands idempotent with one event per transition', async () => {
    const path = `/api/admin/providers/hotel/${hotelId}`;
    for (let index = 0; index < 2; index++) {
      await admin
        .patch(`${path}/deactivate`)
        .send({})
        .expect(204)
        .expect('Cache-Control', 'no-store');
    }
    expect(await outbox.countDocuments({ type: 'hotel.deactivated' })).toBe(1);
    await hold().expect(404);
    for (let index = 0; index < 2; index++) {
      await admin.patch(`${path}/reactivate`).send({}).expect(204);
    }
    expect(await outbox.countDocuments({ type: 'hotel.reactivated' })).toBe(1);
    await hold().expect(201);
    await admin
      .patch(`/api/admin/providers/hotel/${new Types.ObjectId()}/deactivate`)
      .send({})
      .expect(404);
  });

  it('rejects guest/staff actions and malformed or unavailable provider integrations', async () => {
    const path = `/api/admin/providers/hotel/${hotelId}/deactivate`;
    await request(app.getHttpServer()).patch(path).send({}).expect(401);
    await traveler.patch(path).send({}).expect(403);
    await moderator.patch(path).send({}).expect(403);
    await admin.patch(path).send({ active: false }).expect(400);
    await admin
      .patch(`/api/admin/providers/unknown/${hotelId}/deactivate`)
      .send({})
      .expect(400);
    await admin
      .patch('/api/admin/providers/hotel/invalid/deactivate')
      .send({})
      .expect(400);
    await admin
      .patch(`/api/admin/providers/airline/${hotelId}/deactivate`)
      .send({})
      .expect(503);
    expect(await outbox.countDocuments({ type: 'hotel.deactivated' })).toBe(0);
    await hold().expect(201);
  });

  it('rolls provider state back when its transactional event fails', async () => {
    jest
      .spyOn(outbox, 'create')
      .mockRejectedValueOnce(
        new ServiceUnavailableException('Injected outbox failure'),
      );
    await admin
      .patch(`/api/admin/providers/hotel/${hotelId}/deactivate`)
      .send({})
      .expect(503);
    expect(await outbox.countDocuments({ type: 'hotel.deactivated' })).toBe(0);
    await hold().expect(201);
  });

  it('blocks self-deactivation with an upcoming Confirmed hotel booking and preserves the session', async () => {
    const { bookingId, payment } = await initiate();
    await settle(payment);
    const account = await users
      .findOne({ email: 'owner@example.com' })
      .orFail();
    await traveler.delete('/api/users/me').expect(409);
    await traveler.get('/api/auth/me').expect(200);
    expect(await users.findById(account._id).lean()).toMatchObject({
      status: 'active',
      sessionVersion: account.sessionVersion,
    });
    expect((await bookings.findById(bookingId).orFail()).status).toBe(
      'Confirmed',
    );
  });

  it('allows deactivation after cancellation and atomically revokes all owner sessions', async () => {
    const { bookingId, payment } = await initiate();
    await settle(payment);
    await traveler.post(`/api/hotel-bookings/${bookingId}/cancel`).expect(200);
    const account = await users
      .findOne({ email: 'owner@example.com' })
      .orFail();
    const secondSession = await signIn('owner@example.com');
    expect(await sessions.countDocuments({ userId: account._id })).toBe(2);
    await traveler
      .delete('/api/users/me')
      .expect(204)
      .expect('Cache-Control', 'no-store');
    expect(await sessions.countDocuments({ userId: account._id })).toBe(0);
    expect(await users.findById(account._id).lean()).toMatchObject({
      status: 'deactivated',
      sessionVersion: account.sessionVersion + 1,
    });
    await secondSession.get('/api/auth/me').expect(401);
    await traveler.get('/api/auth/me').expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/login')
      .send({ email: 'owner@example.com', password: 'test-password1' })
      .expect(401);
    expect(await refunds.countDocuments()).toBe(1);
  });

  it('ignores an ended stay even if its lazy Completed transition has not yet been persisted', async () => {
    const { bookingId, payment } = await initiate();
    await settle(payment);
    advanceTime(10 * 24 * 60 * 60_000);
    traveler = await signIn('owner@example.com');
    await traveler.delete('/api/users/me').expect(204);
    expect((await bookings.findById(bookingId).orFail()).status).toBe(
      'Confirmed',
    );
  });

  it('keeps a post-deactivation signed success pending until normal expiry, then refunds without confirmation', async () => {
    const { bookingId, payment } = await initiate();
    await traveler.delete('/api/users/me').expect(204);
    intents.set(payment.stripePaymentId, {
      ...intents.get(payment.stripePaymentId)!,
      status: 'succeeded',
    });
    await deliver(event(payment)).expect(409);
    expect((await bookings.findById(bookingId).orFail()).status).toBe(
      'Pending Payment',
    );
    expect(
      await outbox.countDocuments({ type: 'hotel_booking.confirmed' }),
    ).toBe(0);
    advanceTime(11 * 60_000);
    await app.get(PaymentsService).runDue();
    expect((await bookings.findById(bookingId).orFail()).status).toBe(
      'Expired',
    );
    expect(
      await refunds.findOne({ paymentId: payment.id }).lean(),
    ).toMatchObject({ amountMinor: 30_000, reason: 'late_payment' });
    await app.get(RefundsService).runDue();
    expect(
      await refunds.findOne({ paymentId: payment.id }).lean(),
    ).toMatchObject({ status: 'Refunded' });
    expect(
      await outbox.countDocuments({ type: 'hotel_booking.confirmed' }),
    ).toBe(0);
  });

  it('rejects an internal stale payment initiation after deactivation', async () => {
    const { bookingId } = await initiate();
    const account = await users
      .findOne({ email: 'owner@example.com' })
      .orFail();
    await traveler.delete('/api/users/me').expect(204);
    await expect(
      app
        .get(PaymentsService)
        .create(account._id.toString(), 'hotel', bookingId),
    ).rejects.toMatchObject({ status: 403 });
    expect(gateway.createIntent).toHaveBeenCalledTimes(1);
  });

  it('serializes racing deactivation and verified confirmation so a closed account never gets a Confirmed stay', async () => {
    const { bookingId, payment } = await initiate();
    intents.set(payment.stripePaymentId, {
      ...intents.get(payment.stripePaymentId)!,
      status: 'succeeded',
    });
    const [deactivation, settlement] = await Promise.all([
      traveler.delete('/api/users/me'),
      deliver(event(payment)),
    ]);
    const account = await users
      .findOne({ email: 'owner@example.com' })
      .orFail();
    const booking = await bookings.findById(bookingId).orFail();
    if (account.status === 'deactivated') {
      expect(deactivation.status).toBe(204);
      expect(settlement.status).toBe(409);
      expect(booking.status).toBe('Pending Payment');
    } else {
      expect(account.status).toBe('active');
      expect(deactivation.status).toBe(409);
      expect(settlement.status).toBe(200);
      expect(booking.status).toBe('Confirmed');
    }
  });

  it('rolls account deactivation back if session cleanup fails', async () => {
    const account = await users
      .findOne({ email: 'owner@example.com' })
      .orFail();
    jest.spyOn(sessions, 'deleteMany').mockReturnValueOnce({
      exec: async () => {
        throw new ServiceUnavailableException(
          'Injected session cleanup failure',
        );
      },
    } as unknown as ReturnType<typeof sessions.deleteMany>);
    await traveler.delete('/api/users/me').expect(503);
    expect(await users.findById(account._id).lean()).toMatchObject({
      status: 'active',
      sessionVersion: account.sessionVersion,
    });
    expect(await sessions.countDocuments({ userId: account._id })).toBe(1);
    await traveler.get('/api/auth/me').expect(200);
  });

  it('denies guests and forced-password sessions before account deactivation', async () => {
    await request(app.getHttpServer()).delete('/api/users/me').expect(401);
    await users.updateOne(
      { email: 'owner@example.com' },
      { $set: { mustChangePassword: true } },
    );
    await traveler.delete('/api/users/me').expect(403);
    expect(
      (await users.findOne({ email: 'owner@example.com' }).orFail()).status,
    ).toBe('active');
  });

  it('preserves valid payment fulfillment after suspension of an existing booking owner', async () => {
    const { bookingId, payment } = await initiate();
    await users.updateOne(
      { email: 'owner@example.com' },
      { $set: { status: 'suspended' } },
    );
    await settle(payment);
    expect((await bookings.findById(bookingId).orFail()).status).toBe(
      'Confirmed',
    );
  });
});
