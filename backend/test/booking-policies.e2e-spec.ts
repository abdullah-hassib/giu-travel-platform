import {
  Global,
  INestApplication,
  Module,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ClientSession, Model, Schema, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
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
} from '../src/modules/payments/booking-payment.adapter';
import { PolicyAcceptance } from '../src/modules/payments/schemas/policy-acceptance.schema';

const FIXTURE = 'PolicyFixtureBooking';
interface FixtureBooking extends Omit<
  BookingPaymentSnapshot,
  'id' | 'userId' | 'providerId'
> {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  providerId: Types.ObjectId;
  paymentFence: number;
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
});

// A test-only, real-MongoDB adapter. It does not implement or alter teammates' modules.
class FixtureAdapter implements BookingPaymentAdapter {
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

  async getOwned(
    userId: string,
    bookingId: string,
  ): Promise<BookingPaymentSnapshot> {
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
  ): Promise<BookingPaymentSnapshot> {
    const booking = await this.bookings
      .findOneAndUpdate(
        { _id: bookingId, userId, kind: this.kind },
        { $inc: { paymentFence: 1 } },
        { new: true, session },
      )
      .lean()
      .exec();
    if (!booking) throw new NotFoundException('Booking not found');
    return this.snapshot(booking);
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

describe('Booking policy acceptance (real HTTP/replica set, test-only booking adapters)', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryReplSet;
  let app: INestApplication;
  let users: Model<User>;
  let sessions: Model<UserSession>;
  let acceptances: Model<PolicyAcceptance>;
  let bookings: Model<FixtureBooking>;
  let adapters: BookingPaymentAdapter[];
  let ownerId: string;
  let passwordHash: string;

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), { dbName: 'giu_policy_tests' }),
        FixtureModule,
        PaymentsModule,
      ],
    })
      .overrideProvider(BOOKING_PAYMENT_ADAPTERS)
      .useFactory({
        factory: (model: Model<FixtureBooking>) => [
          new FixtureAdapter('flight', model),
          new FixtureAdapter('hotel', model),
        ],
        inject: [getModelToken(FIXTURE)],
      })
      .compile();
    app = module.createNestApplication();
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
    users = app.get(getModelToken(User.name));
    sessions = app.get(getModelToken(UserSession.name));
    acceptances = app.get(getModelToken(PolicyAcceptance.name));
    bookings = app.get(getModelToken(FIXTURE));
    adapters = app.get(BOOKING_PAYMENT_ADAPTERS);
    await Promise.all([
      users.init(),
      sessions.init(),
      acceptances.init(),
      bookings.init(),
    ]);
    passwordHash = await hashPassword('test-password1');
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    adapters.splice(
      0,
      adapters.length,
      new FixtureAdapter('flight', bookings),
      new FixtureAdapter('hotel', bookings),
    );
    await Promise.all([
      users.deleteMany({}),
      sessions.deleteMany({}),
      acceptances.deleteMany({}),
      bookings.deleteMany({}),
    ]);
    ownerId = (
      await users.create({
        email: 'owner@example.com',
        fullName: 'Owner',
        passwordHash,
      })
    )._id.toString();
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
      revision: 'quote-1',
      amountMinor: 10000,
      currency: 'USD',
      holdExpiresAt: new Date(Date.now() + 600000),
      policies:
        kind === 'flight'
          ? {
              type: 'flight',
              cancellation: [
                { daysBefore: 7, refundPercent: 80 },
                { daysBefore: 0, refundPercent: 0 },
              ],
              baggage: [
                {
                  segmentId: 'outbound',
                  cabin: 'Economy',
                  freeBagCount: 1,
                  maxWeightKg: 23,
                  extraBagPriceMinor: 2500,
                  maxExtraBags: 2,
                },
              ],
            }
          : {
              type: 'hotel',
              cancellation: [{ daysBefore: 3, refundPercent: 75 }],
              checkInTime: '14:00',
              checkOutTime: '11:00',
            },
    });
  }
  const path = (kind: BookingKind, id: string) => `/api/bookings/${kind}/${id}`;

  it.each(['flight', 'hotel'] as BookingKind[])(
    'reviews and accepts the complete %s policies with a server timestamp and snapshot',
    async (kind) => {
      const target = await booking(kind);
      const agent = await signIn();
      const url = path(kind, target._id.toString());
      const review = await agent.get(`${url}/policies`).expect(200);
      expect(review.body).toMatchObject({
        bookingType: kind,
        bookingId: target._id.toString(),
        currency: 'USD',
        amountMinor: 10000,
        canAccept: true,
        accepted: false,
        acceptedAt: null,
      });
      expect(review.body.policyToken).toMatch(/^[a-f0-9]{64}$/);
      expect(review.body.policies.type).toBe(kind);
      expect(review.headers['cache-control']).toBe('no-store');
      const start = Date.now();
      const accepted = await agent
        .post(`${url}/accept-policies`)
        .send({ accepted: true, policyToken: review.body.policyToken })
        .expect(200);
      expect(accepted.body.accepted).toBe(true);
      expect(Date.parse(accepted.body.acceptedAt)).toBeGreaterThanOrEqual(
        start,
      );
      const stored = await acceptances.findOne().orFail();
      expect(stored.policyToken).toBe(review.body.policyToken);
      expect(stored.policies).toEqual(accepted.body.policies);
      expect(stored.userId.toString()).toBe(ownerId);
      expect((await agent.get(`${url}/policies`).expect(200)).body).toEqual(
        accepted.body,
      );
    },
  );

  it('reuses the original acceptance timestamp for repeat and concurrent acceptance', async () => {
    const target = await booking();
    const agent = await signIn();
    const url = path('flight', target._id.toString());
    const review = (await agent.get(`${url}/policies`).expect(200)).body;
    const responses = await Promise.all(
      Array.from({ length: 4 }, () =>
        agent
          .post(`${url}/accept-policies`)
          .send({ accepted: true, policyToken: review.policyToken })
          .expect(200),
      ),
    );
    expect(
      new Set(responses.map((response) => response.body.acceptedAt)).size,
    ).toBe(1);
    expect(await acceptances.countDocuments()).toBe(1);
  });

  it.each([
    {},
    { accepted: false },
    { accepted: 'true' },
    { accepted: null },
    { policyToken: null },
    { policyToken: 'invalid' },
    { amountMinor: 1 },
    { policies: {} },
    { acceptedAt: '2020-01-01' },
    { userId: new Types.ObjectId().toString() },
  ])(
    'rejects invalid or extra acceptance fields atomically (%j)',
    async (invalid) => {
      const target = await booking();
      const agent = await signIn();
      const url = path('flight', target._id.toString());
      const review = (await agent.get(`${url}/policies`).expect(200)).body;
      const body =
        Object.keys(invalid).length === 0
          ? {}
          : { accepted: true, policyToken: review.policyToken, ...invalid };
      await agent.post(`${url}/accept-policies`).send(body).expect(400);
      expect(await acceptances.countDocuments()).toBe(0);
      expect((await bookings.findById(target._id).orFail()).paymentFence).toBe(
        0,
      );
    },
  );

  it.each([
    { revision: 'quote-2' },
    { amountMinor: 20000 },
    { holdExpiresAt: new Date(Date.now() + 900000) },
    { 'policies.baggage.0.extraBagPriceMinor': 3000 },
    { 'policies.cancellation.0.refundPercent': 90 },
  ])(
    'requires new review when quote, deadline or policy changes (%j)',
    async (change) => {
      const target = await booking();
      const agent = await signIn();
      const url = path('flight', target._id.toString());
      const review = (await agent.get(`${url}/policies`).expect(200)).body;
      await bookings.updateOne({ _id: target._id }, { $set: change });
      await agent
        .post(`${url}/accept-policies`)
        .send({ accepted: true, policyToken: review.policyToken })
        .expect(409);
      expect(await acceptances.countDocuments()).toBe(0);
    },
  );

  it('preserves an old snapshot and rejects its reuse after a policy change', async () => {
    const target = await booking();
    const agent = await signIn();
    const url = path('flight', target._id.toString());
    const review = (await agent.get(`${url}/policies`).expect(200)).body;
    const original = (
      await agent
        .post(`${url}/accept-policies`)
        .send({ accepted: true, policyToken: review.policyToken })
        .expect(200)
    ).body;
    await bookings.updateOne(
      { _id: target._id },
      { $set: { 'policies.baggage.0.maxExtraBags': 3 } },
    );
    const current = (await agent.get(`${url}/policies`).expect(200)).body;
    expect(current.accepted).toBe(false);
    expect(current.acceptedAt).toBeNull();
    expect((await acceptances.findOne().orFail()).policies).toEqual(
      original.policies,
    );
    await agent
      .post(`${url}/accept-policies`)
      .send({ accepted: true, policyToken: current.policyToken })
      .expect(200);
    expect((await acceptances.findOne().orFail()).policies).toEqual(
      current.policies,
    );
  });

  it.each(['Confirmed', 'Completed', 'Cancelled', 'Expired'])(
    'allows policy reading but rejects acceptance for %s bookings',
    async (state) => {
      const target = await booking();
      await bookings.updateOne({ _id: target._id }, { $set: { state } });
      const agent = await signIn();
      const url = path('flight', target._id.toString());
      const review = (await agent.get(`${url}/policies`).expect(200)).body;
      expect(review.canAccept).toBe(false);
      await agent
        .post(`${url}/accept-policies`)
        .send({ accepted: true, policyToken: review.policyToken })
        .expect(409);
    },
  );

  it('rejects expired Pending Payment holds while preserving prior consent history', async () => {
    const target = await booking();
    const agent = await signIn();
    const url = path('flight', target._id.toString());
    const review = (await agent.get(`${url}/policies`).expect(200)).body;
    await agent
      .post(`${url}/accept-policies`)
      .send({ accepted: true, policyToken: review.policyToken })
      .expect(200);
    await bookings.updateOne(
      { _id: target._id },
      { $set: { state: 'Expired' } },
    );
    const expired = (await agent.get(`${url}/policies`).expect(200)).body;
    expect(expired).toMatchObject({
      accepted: true,
      acceptedAt: expect.any(String),
      canAccept: false,
    });
    await agent
      .post(`${url}/accept-policies`)
      .send({ accepted: true, policyToken: review.policyToken })
      .expect(409);
  });

  it('rejects a passed hold deadline even when the booking state job has not run', async () => {
    const target = await booking();
    await bookings.updateOne(
      { _id: target._id },
      { $set: { holdExpiresAt: new Date(0) } },
    );
    const agent = await signIn();
    const url = path('flight', target._id.toString());
    const review = (await agent.get(`${url}/policies`).expect(200)).body;
    await agent
      .post(`${url}/accept-policies`)
      .send({ accepted: true, policyToken: review.policyToken })
      .expect(409);
  });

  it('denies guests and other owners for both routes', async () => {
    const target = await booking();
    const url = path('flight', target._id.toString());
    await request(app.getHttpServer()).get(`${url}/policies`).expect(401);
    await request(app.getHttpServer())
      .post(`${url}/accept-policies`)
      .send({})
      .expect(401);
    await users.create({
      email: 'other@example.com',
      fullName: 'Other',
      passwordHash,
    });
    const other = await signIn('other@example.com');
    await other.get(`${url}/policies`).expect(404);
    await other
      .post(`${url}/accept-policies`)
      .send({ accepted: true, policyToken: 'a'.repeat(64) })
      .expect(404);
  });

  it.each(['admin', 'airline_moderator', 'hotel_moderator'] as UserRole[])(
    'denies authoring to the staff-only %s role',
    async (role) => {
      const target = await booking();
      await users.updateOne({ _id: ownerId }, { $set: { roles: [role] } });
      const agent = await signIn();
      await agent
        .get(`${path('flight', target._id.toString())}/policies`)
        .expect(403);
      await agent
        .post(`${path('flight', target._id.toString())}/accept-policies`)
        .send({})
        .expect(403);
    },
  );

  it('keeps forced-password-change sessions restricted', async () => {
    const target = await booking();
    await users.updateOne(
      { _id: ownerId },
      { $set: { mustChangePassword: true } },
    );
    const agent = await signIn();
    await agent
      .get(`${path('flight', target._id.toString())}/policies`)
      .expect(403);
  });

  it('validates type/IDs, normalizes identifier/token case and denies absent integrations', async () => {
    const target = await booking();
    const agent = await signIn();
    await agent.get('/api/bookings/other/not-an-id/policies').expect(400);
    const url = path('flight', target._id.toString().toUpperCase());
    const review = (await agent.get(`${url}/policies`).expect(200)).body;
    await agent
      .post(`${url}/accept-policies`)
      .send({ accepted: true, policyToken: review.policyToken.toUpperCase() })
      .expect(200);
    adapters.splice(0, adapters.length);
    await agent.get(`${url}/policies`).expect(503);
    await agent
      .post(`${url}/accept-policies`)
      .send({ accepted: true, policyToken: review.policyToken })
      .expect(503);
  });

  it.each([
    { currency: 'EUR' },
    { amountMinor: 0 },
    { state: 'Unknown' },
    { revision: '' },
    { 'policies.baggage': [] },
    { 'policies.baggage.0.maxWeightKg': 0 },
    { 'policies.cancellation.0.refundPercent': 101 },
    { 'policies.cancellation.0.daysBefore': -1 },
  ])(
    'rejects invalid data supplied by the booking adapter (%j)',
    async (invalid) => {
      const target = await booking();
      await bookings.updateOne({ _id: target._id }, { $set: invalid });
      const agent = await signIn();
      await agent
        .get(`${path('flight', target._id.toString())}/policies`)
        .expect(502);
      expect(await acceptances.countDocuments()).toBe(0);
    },
  );

  it('strips extra fields from the provider policy projection and stores the sanitized snapshot', async () => {
    const target = await booking();
    await bookings.updateOne(
      { _id: target._id },
      {
        $set: {
          'policies.privateDebug': 'private-fixture',
          'policies.baggage.0.privateDebug': 'private-fixture',
        },
      },
    );
    const agent = await signIn();
    const url = path('flight', target._id.toString());
    const review = (await agent.get(`${url}/policies`).expect(200)).body;
    expect(JSON.stringify(review)).not.toContain('private-fixture');
    await agent
      .post(`${url}/accept-policies`)
      .send({ accepted: true, policyToken: review.policyToken })
      .expect(200);
    expect(
      JSON.stringify((await acceptances.findOne().orFail()).policies),
    ).not.toContain('private-fixture');
  });

  it('rolls back the booking fence if acceptance persistence fails', async () => {
    const target = await booking();
    const agent = await signIn();
    const url = path('flight', target._id.toString());
    const review = (await agent.get(`${url}/policies`).expect(200)).body;
    jest.spyOn(acceptances, 'findOneAndUpdate').mockImplementationOnce(() => {
      throw new Error('Simulated policy storage failure');
    });
    await agent
      .post(`${url}/accept-policies`)
      .send({ accepted: true, policyToken: review.policyToken })
      .expect(500);
    expect((await bookings.findById(target._id).orFail()).paymentFence).toBe(0);
    expect(await acceptances.countDocuments()).toBe(0);
  });

  it('documents both policy variants, validation, permission and integration errors', async () => {
    const document = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    const operation =
      document.paths['/api/bookings/{type}/{id}/accept-policies'].post;
    expect(Object.keys(operation.responses)).toEqual(
      expect.arrayContaining([
        '200',
        '400',
        '401',
        '403',
        '404',
        '409',
        '502',
        '503',
      ]),
    );
    expect(
      document.components.schemas.BookingPolicyReviewDto.properties.policies
        .oneOf,
    ).toHaveLength(2);
  });
});
