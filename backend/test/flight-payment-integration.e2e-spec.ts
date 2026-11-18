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
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { Connection, Model, Types } from 'mongoose';
import Stripe from 'stripe';
import request from 'supertest';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { AdministrationModule } from '../src/modules/administration/administration.module';
import { hashPassword } from '../src/modules/auth/security/password';
import { FlightsModule } from '../src/modules/flights/flights.module';
import { Flight } from '../src/modules/flights/schemas/flight.schema';
import { FlightBooking } from '../src/modules/flight-bookings/schemas/flight-booking.schema';
import { FlightBookingsService } from '../src/modules/flight-bookings/flight-bookings.service';
import { PaymentsModule } from '../src/modules/payments/payments.module';
import { PaymentsService } from '../src/modules/payments/payments.service';
import { configurePaymentBodyParsers } from '../src/modules/payments/payment-body-parsers';
import {
  GatewayIntent,
  GatewayRefund,
  PaymentIntentInput,
  PaymentIntentReference,
  RefundInput,
  StripeTestGateway,
} from '../src/modules/payments/stripe-test.gateway';
import { Refund } from '../src/modules/refunds/schemas/refund.schema';
import { RefundsService } from '../src/modules/refunds/refunds.service';
import { User } from '../src/modules/users/schemas/user.schema';
import { referenceModels } from '../src/modules/reference-data/reference.schema';
import { seedOfficialReferences } from '../src/modules/reference-data/reference-seed';
import { DomainEventConsumer } from '../src/modules/domain-events/domain-event-consumer';
import { DomainEventOutbox } from '../src/modules/domain-events/schemas/domain-event-outbox.schema';

const signingSecret = 'whsec_flightIntegrationSyntheticOnly';
const verifier = new StripeTestGateway(
  new ConfigService({ STRIPE_WEBHOOK_SECRET: signingSecret }),
  () => {
    throw new Error('External network disabled');
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
      useValue: new ConfigService({ NODE_ENV: 'test' }),
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

describe('Adham flight domain with real Hassib payments, administration and Omar delivery', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let users: Model<User>;
  let flights: Model<Flight>;
  let bookings: Model<FlightBooking>;
  let refunds: Model<Refund>;
  let admin: Agent, moderator: Agent, traveler: Agent, other: Agent;
  let airlineId: string, otherAirlineId: string, flightId: string;
  let passwordHash: string;
  const intents = new Map<string, GatewayIntent>();
  const passenger = {
    fullName: 'Test Traveler',
    dateOfBirth: '1990-05-10',
    identityDocumentNumber: 'SYNTHETIC-ID',
    extraBags: 0,
  };
  const cabin = {
    category: 'Economy',
    totalSeats: 2,
    price: 10_000,
    freeBags: 1,
    maxWeightPerBag: 23,
  };
  const createFlight = (overrides: Record<string, unknown> = {}) =>
    moderator.post('/api/flights').send({
      flightNumber: 'GIU101',
      departureAirportCode: 'CAI',
      arrivalAirportCode: 'JFK',
      departureLocalDateTime: '2099-01-15T12:00',
      arrivalLocalDateTime: '2099-01-15T16:00',
      cabins: [cabin],
      ...overrides,
    });

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      instanceOpts: [{ launchTimeout: 30_000 }],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), {
          dbName: 'giu_flight_integration',
        }),
        AdministrationModule,
        FlightsModule,
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
    SwaggerModule.setup(
      'api/docs',
      app,
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('Flight integration')
          .addCookieAuth(
            'giu_session',
            { type: 'apiKey', in: 'cookie' },
            'giu_session',
          )
          .build(),
      ),
    );
    await app.init();
    connection = app.get(getConnectionToken());
    users = app.get(getModelToken(User.name));
    flights = app.get(getModelToken(Flight.name));
    bookings = app.get(getModelToken(FlightBooking.name));
    refunds = app.get(getModelToken(Refund.name));
    await seedOfficialReferences(connection);
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    passwordHash = await hashPassword('test-password1');
  });
  beforeEach(async () => {
    jest.clearAllMocks();
    intents.clear();
    gateway.createIntent.mockImplementation(async (input) => {
      const id = 'pi_' + input.paymentId;
      const intent: GatewayIntent = intents.get(id) ?? {
        id,
        paymentId: input.paymentId,
        amountMinor: input.amountMinor,
        currency: 'USD',
        status: 'requires_payment_method',
        clientSecret: id + '_secret_synthetic',
      };
      intents.set(id, intent);
      return { ...intent };
    });
    gateway.retrieveIntent.mockImplementation(async ({ intentId }) => {
      const intent = intents.get(intentId);
      if (!intent)
        throw new ServiceUnavailableException('Controlled gateway unavailable');
      return { ...intent };
    });
    gateway.cancelIntent.mockImplementation(async ({ intentId }) => {
      const intent = intents.get(intentId)!;
      if (intent.status === 'succeeded')
        throw new ConflictException('Succeeded payment needs refund');
      const result: GatewayIntent = {
        ...intent,
        status: 'canceled',
        clientSecret: null,
      };
      intents.set(intentId, result);
      return result;
    });
    gateway.createRefund.mockImplementation(async (input) => ({
      id: 're_' + input.refundId,
      intentId: input.intentId,
      amountMinor: input.refundAmountMinor,
      currency: 'USD',
      status: 'Refunded',
    }));
    const referenceCollections = new Set(
      Object.values(referenceModels(connection)).map(
        (model) => model.collection.name,
      ),
    );
    await Promise.all(
      Object.values(connection.collections)
        .filter((collection) => !referenceCollections.has(collection.name))
        .map((collection) => collection.deleteMany({})),
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
    admin = await login('admin@example.com');
    traveler = await login('owner@example.com');
    other = await login('other@example.com');
    airlineId = (
      await admin
        .post('/api/airlines')
        .send({
          name: 'GIU Airline',
          code: 'GI',
          logoUrl: 'https://example.com/logo.png',
        })
        .expect(201)
    ).body.id;
    otherAirlineId = (
      await admin
        .post('/api/airlines')
        .send({
          name: 'Other Airline',
          code: 'OT',
          logoUrl: 'https://example.com/other.png',
        })
        .expect(201)
    ).body.id;
    await admin
      .post('/api/admin/moderators')
      .send({
        email: 'mod@example.com',
        fullName: 'Airline Moderator',
        password: 'temporary-password1',
        role: 'airline_moderator',
        providerId: airlineId,
      })
      .expect(201);
    moderator = await login('mod@example.com', 'temporary-password1');
    await moderator
      .patch('/api/auth/change-password')
      .send({
        currentPassword: 'temporary-password1',
        newPassword: 'changed-password2',
      })
      .expect(204);
    moderator = await login('mod@example.com', 'changed-password2');
    await moderator
      .put('/api/airlines/' + airlineId + '/baggage-policy')
      .send({ extraBagPrice: 25, maxExtraBags: 2 })
      .expect(200);
    await moderator
      .put('/api/airlines/' + airlineId + '/cancellation-policy')
      .send({ tiers: [{ daysBeforeDeparture: 0, refundPercentage: 50 }] })
      .expect(200);
    flightId = (await createFlight().expect(201)).body.id;
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });
  afterAll(async () => {
    await app?.close();
    await server?.stop();
  });
  async function login(email: string, password = 'test-password1') {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password }).expect(200);
    return agent;
  }
  function hold(overrides: Record<string, unknown> = {}, agent = traveler) {
    return agent
      .post('/api/flight-bookings/hold')
      .send({
        flightId,
        cabinCategory: 'Economy',
        passengers: [passenger],
        ...overrides,
      });
  }
  async function initiate(overrides: Record<string, unknown> = {}) {
    const bookingId: string = (await hold(overrides).expect(201)).body.booking
      .id;
    const path = '/api/bookings/flight/' + bookingId;
    const review = (await traveler.get(path + '/policies').expect(200)).body;
    await traveler
      .post(path + '/accept-policies')
      .send({ accepted: true, policyToken: review.policyToken })
      .expect(200);
    const payment: PaymentView = (
      await traveler
        .post('/api/payments')
        .send({ bookingType: 'flight', bookingId })
        .expect(201)
    ).body.payment;
    return { bookingId, payment };
  }
  function signed(payment: PaymentView) {
    const payload = JSON.stringify({
      id: 'evt_' + new Types.ObjectId(),
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
    return {
      payload,
      signature: Stripe.webhooks.generateTestHeaderString({
        payload,
        secret: signingSecret,
      }),
    };
  }
  function deliver(message: ReturnType<typeof signed>) {
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
    const message = signed(payment);
    await deliver(message).expect(200);
    return message;
  }
  function advance(minutes: number) {
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
    jest.setSystemTime(Date.now() + minutes * 60_000);
  }
  async function returnFlight() {
    return (
      await createFlight({
        flightNumber: 'GIU102',
        departureAirportCode: 'JFK',
        arrivalAirportCode: 'CAI',
        departureLocalDateTime: '2099-01-24T12:00',
        arrivalLocalDateTime: '2099-01-25T12:00',
      }).expect(201)
    ).body.id as string;
  }

  it('uses provider-first provisioning, exactly one assignment, and rejects the obsolete parallel moderator field', async () => {
    await admin
      .post('/api/airlines')
      .send({
        name: 'Invalid',
        code: 'XX',
        logoUrl: 'https://example.com/a.png',
        moderatorId: new Types.ObjectId().toString(),
      })
      .expect(400);
    await traveler
      .post('/api/airlines')
      .send({
        name: 'Denied',
        code: 'NO',
        logoUrl: 'https://example.com/a.png',
      })
      .expect(403);
    await admin
      .post('/api/airlines')
      .send({
        name: 'Duplicate',
        code: 'GI',
        logoUrl: 'https://example.com/a.png',
      })
      .expect(409);
    await moderator
      .patch('/api/airlines/' + otherAirlineId)
      .send({ name: 'Wrong provider' })
      .expect(403);
    await moderator
      .patch('/api/airlines/' + airlineId)
      .send({ name: 'Updated Airline' })
      .expect(200);
    await moderator
      .put('/api/airlines/' + otherAirlineId + '/baggage-policy')
      .send({ extraBagPrice: 5, maxExtraBags: 1 })
      .expect(403);
    await moderator
      .put('/api/airlines/' + airlineId + '/cancellation-policy')
      .send({
        tiers: [
          { daysBeforeDeparture: 1, refundPercentage: 10 },
          { daysBeforeDeparture: 1, refundPercentage: 20 },
        ],
      })
      .expect(400);
  });

  it('preserves every official reference endpoint and stores canonical IATA identifiers and UTC instants', async () => {
    for (const endpoint of [
      'countries',
      'cities',
      'airports',
      'attractions',
      'currencies',
    ])
      await request(app.getHttpServer())
        .get('/api/' + endpoint)
        .expect(200);
    const flight = await flights.findById(flightId).orFail();
    expect(flight.departureAirportId).toBe('CAI');
    expect(flight.arrivalAirportId).toBe('JFK');
    expect(flight.departureAt.toISOString()).toBe('2099-01-15T10:00:00.000Z');
    expect(flight.cabins[0]).toMatchObject({
      totalSeats: 2,
      bookedSeats: 0,
      heldSeats: 0,
    });
  });

  it.each([
    { departureAirportCode: 'ZZZ' },
    { arrivalAirportCode: 'CAI' },
    { departureLocalDateTime: '2020-01-01T12:00' },
    { arrivalLocalDateTime: '2099-01-15T01:00' },
    { cabins: [cabin, cabin] },
    { cabins: [{ ...cabin, totalSeats: 0 }] },
    { cabins: [{ ...cabin, price: 0 }] },
    { cabins: [{ ...cabin, totalSeats: Number.MAX_SAFE_INTEGER + 1 }] },
  ])(
    'rejects invalid flight creation without changing inventory: %j',
    async (override) => {
      expect([400, 404]).toContain(
        (await createFlight({ flightNumber: 'INVALID', ...override })).status,
      );
      expect(await flights.countDocuments()).toBe(1);
    },
  );

  it('rejects duplicate flight/date/airline and denies unassigned or inactive providers', async () => {
    await createFlight().expect(409);
    await traveler.post('/api/flights').send({}).expect(403);
    await admin
      .patch('/api/admin/providers/airline/' + airlineId + '/deactivate')
      .send({})
      .expect(204);
    await createFlight({ flightNumber: 'INACTIVE' }).expect(403);
    await hold().expect(404);
    await admin
      .patch('/api/admin/providers/airline/' + airlineId + '/reactivate')
      .send({})
      .expect(204);
    await hold().expect(201);
  });

  it('calculates adult/child seats, infant ten-percent fare and baggage before a hold', async () => {
    const passengers = [
      passenger,
      { ...passenger, fullName: 'Child', dateOfBirth: '2090-01-01' },
      { ...passenger, fullName: 'Infant', dateOfBirth: '2098-01-01' },
    ];
    const summary = await traveler
      .post('/api/flight-bookings')
      .send({ flightId, cabinCategory: 'Economy', passengers })
      .expect(201);
    expect(summary.body.totalAmountMinor).toBe(21_000);
    expect(summary.body.segments[0].seatsReserved).toBe(2);
    expect(summary.body.booking.holdCreated).toBe(false);
    expect(await bookings.countDocuments()).toBe(0);
    const held = await hold({
      passengers: [{ ...passenger, extraBags: 1, extraBagWeightsKg: [20] }],
    }).expect(201);
    expect(held.body.booking.totalAmountMinor).toBe(12_500);
    expect(held.body.booking.reference).toBeNull();
  });

  it.each(
    [
      [],
      [{ ...passenger, passengerType: 'Infant' }],
      [{ ...passenger, dateOfBirth: '2098-01-01' }],
      [{ ...passenger, extraBags: 3, extraBagWeightsKg: [10, 10, 10] }],
      [{ ...passenger, extraBags: 1 }],
      [{ ...passenger, extraBags: 1, extraBagWeightsKg: [24] }],
      [{ ...passenger, dateOfBirth: '2099-02-30' }],
    ].map((passengers) => ({ passengers })),
  )(
    'rejects invalid passenger/baggage input with no held seat: %j',
    async ({ passengers }) => {
      await hold({ passengers }).expect(400);
      expect(
        (await flights.findById(flightId).orFail()).cabins[0].heldSeats,
      ).toBe(0);
    },
  );

  it('reserves the last seat atomically under concurrent holds and expires both once after ten minutes', async () => {
    const results = await Promise.all([hold(), hold({}, other), hold()]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 201, 409]);
    expect(
      (await flights.findById(flightId).orFail()).cabins[0].heldSeats,
    ).toBe(2);
    advance(11);
    await app.get(FlightBookingsService).expireDue();
    await app.get(FlightBookingsService).expireDue();
    expect(
      (await flights.findById(flightId).orFail()).cabins[0].heldSeats,
    ).toBe(0);
    expect(await bookings.countDocuments({ status: 'Expired' })).toBe(2);
    traveler = await login('owner@example.com');
    await hold().expect(201);
  });

  it('requires policy acceptance and real SDK verification, confirms once and emits actual notifications', async () => {
    const id: string = (await hold().expect(201)).body.booking.id;
    await traveler
      .post('/api/payments')
      .send({ bookingType: 'flight', bookingId: id })
      .expect(409);
    const { bookingId, payment } = await initiate();
    const message = signed(payment);
    await request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set('Stripe-Signature', 'invalid')
      .send(message.payload)
      .expect(400);
    const verified = await settle(payment);
    await deliver(verified).expect(200);
    const booking = (
      await traveler.get('/api/flight-bookings/' + bookingId).expect(200)
    ).body;
    expect(booking.status).toBe('Confirmed');
    expect(booking.reference).toMatch(/^FLT-/);
    expect((await flights.findById(flightId).orFail()).cabins[0]).toMatchObject(
      { heldSeats: 1, bookedSeats: 1 },
    );
    await other.get('/api/flight-bookings/' + bookingId).expect(404);
    await app.get(DomainEventConsumer).consumePending();
    expect(
      (await traveler.get('/api/notifications').expect(200)).body.data.some(
        (n: { eventType: string; resourceId: string }) =>
          n.eventType === 'booking.confirmed' && n.resourceId === bookingId,
      ),
    ).toBe(true);
  });

  it('pays and cancels a round trip as one immutable quote/refund and releases both inventories', async () => {
    const returnFlightId = await returnFlight();
    const { bookingId, payment } = await initiate({ returnFlightId });
    expect((await bookings.findById(bookingId).orFail()).totalAmountMinor).toBe(
      20_000,
    );
    await settle(payment);
    await moderator
      .put('/api/airlines/' + airlineId + '/cancellation-policy')
      .send({ tiers: [{ daysBeforeDeparture: 0, refundPercentage: 100 }] })
      .expect(200);
    expect(
      (await traveler.get('/api/flight-bookings/' + bookingId).expect(200)).body
        .refundPreview.refundMinor,
    ).toBe(10_000);
    await other
      .post('/api/flight-bookings/' + bookingId + '/cancel')
      .send({})
      .expect(404);
    await traveler
      .post('/api/flight-bookings/' + bookingId + '/cancel')
      .send({})
      .expect(200);
    await traveler
      .post('/api/flight-bookings/' + bookingId + '/cancel')
      .send({})
      .expect(409);
    expect(await refunds.countDocuments({ paymentId: payment.id })).toBe(1);
    expect(
      (await refunds.findOne({ paymentId: payment.id }).orFail()).amountMinor,
    ).toBe(10_000);
    for (const id of [flightId, returnFlightId])
      expect((await flights.findById(id).orFail()).cabins[0]).toMatchObject({
        heldSeats: 0,
        bookedSeats: 0,
      });
    await app.get(RefundsService).runDue();
    expect(gateway.createRefund).toHaveBeenCalledTimes(1);
  });

  it('rejects invalid round-trip routes and rolls back outbound inventory if the return has no seat', async () => {
    await hold({ returnFlightId: flightId }).expect(400);
    const wrong = (await createFlight({ flightNumber: 'WRONG' }).expect(201))
      .body.id;
    await hold({ returnFlightId: wrong }).expect(400);
    const returnFlightId = await returnFlight();
    await flights.updateOne(
      { _id: returnFlightId },
      { $set: { 'cabins.0.bookedSeats': 2 } },
    );
    await hold({ returnFlightId }).expect(409);
    expect(
      (await flights.findById(flightId).orFail()).cabins[0].heldSeats,
    ).toBe(0);
  });

  it('refunds a verified late success without reusing an expired hold or overselling its replacement', async () => {
    const { bookingId, payment } = await initiate();
    advance(11);
    await app.get(FlightBookingsService).expireDue();
    other = await login('other@example.com');
    await hold(
      { passengers: [passenger, { ...passenger, fullName: 'Second Adult' }] },
      other,
    ).expect(201);
    await settle(payment);
    await app.get(RefundsService).runDue();
    expect((await bookings.findById(bookingId).orFail()).status).toBe(
      'Expired',
    );
    expect((await flights.findById(flightId).orFail()).cabins[0]).toMatchObject(
      { heldSeats: 2, bookedSeats: 0 },
    );
    expect(
      (await refunds.findOne({ paymentId: payment.id }).orFail()).amountMinor,
    ).toBe(10_000);
  });

  it('blocks account deactivation for upcoming confirmed flights and preserves deactivation/payment race safety', async () => {
    const { bookingId, payment } = await initiate();
    await settle(payment);
    await traveler.delete('/api/users/me').expect(409);
    await traveler.get('/api/auth/me').expect(200);
    await traveler
      .post('/api/flight-bookings/' + bookingId + '/cancel')
      .send({})
      .expect(200);
    await traveler.delete('/api/users/me').expect(204);
    await traveler.get('/api/auth/me').expect(401);
  });

  it('keeps paid reservations after provider deactivation and notifies only affected users', async () => {
    const { bookingId, payment } = await initiate();
    await settle(payment);
    await admin
      .patch('/api/admin/providers/airline/' + airlineId + '/deactivate')
      .send({})
      .expect(204);
    await admin
      .patch('/api/admin/providers/airline/' + airlineId + '/deactivate')
      .send({})
      .expect(204);
    expect((await bookings.findById(bookingId).orFail()).status).toBe(
      'Confirmed',
    );
    await hold({}, other).expect(404);
    const historyBefore = (await admin.get('/api/admin/audit-logs?action=provider.deactivated').expect(200)).body;
    expect(historyBefore.meta.total).toBe(1);
    expect(historyBefore.data[0]).toMatchObject({ target: { type: 'airline', id: airlineId }, deliveryStatus: 'pending' });
    await app.get(DomainEventConsumer).consumePending();
    const historyAfter = (await admin.get('/api/admin/audit-logs?action=provider.deactivated').expect(200)).body;
    expect(historyAfter.meta.total).toBe(1);
    expect(historyAfter.data[0]).toMatchObject({ id: historyBefore.data[0].id, deliveryStatus: 'delivered' });
    for (const agent of [traveler, moderator])
      expect(
        (await agent.get('/api/notifications').expect(200)).body.data.filter(
          (n: { eventType: string }) => n.eventType === 'provider.deactivated',
        ),
      ).toHaveLength(1);
    expect(
      (await other.get('/api/notifications').expect(200)).body.meta.total,
    ).toBe(0);
    const events = app.get<Model<DomainEventOutbox>>(
      getModelToken(DomainEventOutbox.name),
    );
    expect(await events.countDocuments({ type: 'provider.deactivated' })).toBe(
      1,
    );
  });

  it('rolls cancellation, inventory and state back when refund authorization cannot commit', async () => {
    const { bookingId, payment } = await initiate();
    await settle(payment);
    jest
      .spyOn(app.get(RefundsService), 'enqueueCancellation')
      .mockRejectedValueOnce(new Error('controlled refund failure'));
    await traveler
      .post('/api/flight-bookings/' + bookingId + '/cancel')
      .send({})
      .expect(500);
    expect((await bookings.findById(bookingId).orFail()).status).toBe(
      'Confirmed',
    );
    expect(
      (await flights.findById(flightId).orFail()).cabins[0].bookedSeats,
    ).toBe(1);
    expect(await refunds.countDocuments()).toBe(0);
  });

  it('documents the flight hold, policy and ownership routes in the combined Swagger graph', async () => {
    const document = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    for (const path of [
      '/api/airlines',
      '/api/flights',
      '/api/flight-bookings/hold',
      '/api/flight-bookings/{id}',
      '/api/bookings/{type}/{id}/policies',
    ])
      expect(document.paths[path]).toBeDefined();
  });

  it('denies guests, moderator booking attempts, forced-password and unassigned management', async () => {
    await request(app.getHttpServer())
      .post('/api/flight-bookings/hold')
      .send({})
      .expect(401);
    await hold({}, moderator).expect(403);
    await admin
      .post('/api/admin/moderators')
      .send({
        email: 'second@example.com',
        fullName: 'Second Moderator',
        password: 'temporary-password1',
        role: 'airline_moderator',
        providerId: otherAirlineId,
      })
      .expect(201);
    const forced = await login('second@example.com', 'temporary-password1');
    await forced
      .patch('/api/airlines/' + otherAirlineId)
      .send({ name: 'Too early' })
      .expect(403);
    await users.create({
      email: 'unassigned@example.com',
      fullName: 'Unassigned',
      roles: ['airline_moderator'],
      passwordHash,
    });
    const unassigned = await login('unassigned@example.com');
    await unassigned
      .patch('/api/airlines/' + airlineId)
      .send({ name: 'No assignment' })
      .expect(403);
  });

  it('serializes a racing account deactivation and signed flight confirmation', async () => {
    const { bookingId, payment } = await initiate();
    intents.set(payment.stripePaymentId, {
      ...intents.get(payment.stripePaymentId)!,
      status: 'succeeded',
    });
    const [deactivation, settlement] = await Promise.all([
      traveler.delete('/api/users/me'),
      deliver(signed(payment)),
    ]);
    const account = await users
      .findOne({ email: 'owner@example.com' })
      .orFail();
    const booking = await bookings.findById(bookingId).orFail();
    if (account.status === 'deactivated') {
      expect(deactivation.status).toBe(204);
      expect(settlement.status).toBe(409);
      expect(booking.status).toBe('Pending Payment');
      advance(11);
      await app.get(FlightBookingsService).expireDue();
      await app.get(PaymentsService).runDue();
      await app.get(RefundsService).runDue();
      expect((await bookings.findById(bookingId).orFail()).status).toBe(
        'Expired',
      );
      expect(await refunds.countDocuments({ paymentId: payment.id })).toBe(1);
    } else {
      expect(account.status).toBe('active');
      expect(deactivation.status).toBe(409);
      expect(settlement.status).toBe(200);
      expect(booking.status).toBe('Confirmed');
    }
  });

  it('groups only owned bookings, derives past completion and blocks cancellation after departure', async () => {
    const { bookingId, payment } = await initiate();
    await settle(payment);
    expect(
      (
        await traveler.get('/api/flight-bookings?group=Upcoming').expect(200)
      ).body.data.map((b: { id: string }) => b.id),
    ).toEqual([bookingId]);
    expect(
      (await other.get('/api/flight-bookings').expect(200)).body.meta.total,
    ).toBe(0);
    await bookings.updateOne(
      { _id: bookingId },
      {
        $set: {
          'segments.0.departureAt': new Date(Date.now() - 2 * 86_400_000),
          'segments.0.arrivalAt': new Date(Date.now() - 86_400_000),
        },
      },
    );
    const past = (
      await traveler.get('/api/flight-bookings?group=Past').expect(200)
    ).body;
    expect(past.data[0]).toMatchObject({ id: bookingId, status: 'Completed' });
    await traveler
      .post('/api/flight-bookings/' + bookingId + '/cancel')
      .send({})
      .expect(409);
    await traveler.get('/api/flight-bookings?group=unknown').expect(400);
    await traveler.get('/api/flight-bookings?page=0').expect(400);
  });

  it('rolls back all seat reservations when booking persistence fails', async () => {
    jest.spyOn(bookings, 'create').mockImplementationOnce(() => {
      throw new Error('controlled booking persistence failure');
    });
    await hold().expect(500);
    expect(await bookings.countDocuments()).toBe(0);
    expect(
      (await flights.findById(flightId).orFail()).cabins[0].heldSeats,
    ).toBe(0);
  });
});
