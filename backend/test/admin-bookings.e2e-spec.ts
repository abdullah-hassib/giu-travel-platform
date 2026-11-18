import {
  Global,
  INestApplication,
  Module,
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
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { Connection, Model, Types } from 'mongoose';
import request from 'supertest';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { AdministrationModule } from '../src/modules/administration/administration.module';
import { hashPassword } from '../src/modules/auth/security/password';
import { HotelBooking } from '../src/modules/hotel-bookings/schemas/hotel-booking.schema';
import { FlightBooking } from '../src/modules/flight-bookings/schemas/flight-booking.schema';
import { addDays, todayUtc } from '../src/modules/hotels/stay-rules';
import { User } from '../src/modules/users/schemas/user.schema';

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
const day = (offset: number) => addDays(todayUtc(), offset);

describe('ACC-17 hotel, flight and globally combined administration read projection', () => {
  jest.setTimeout(180_000);
  let app: INestApplication;
  let server: MongoMemoryServer;
  let connection: Connection;
  let users: Model<User>;
  let bookings: Model<HotelBooking>;
  let flights: Model<FlightBooking>;
  let admin: Agent;
  let traveler: Agent;
  let moderator: Agent;
  let ownerId: Types.ObjectId;
  let adminId: Types.ObjectId;
  let passwordHash: string;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), {
          dbName: 'giu_admin_booking_reads',
        }),
        AdministrationModule,
      ],
    }).compile();
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
      SwaggerModule.createDocument(app, new DocumentBuilder().build()),
    );
    await app.init();
    connection = app.get(getConnectionToken());
    users = app.get(getModelToken(User.name));
    bookings = app.get(getModelToken(HotelBooking.name));
    flights = app.get(getModelToken(FlightBooking.name));
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    passwordHash = await hashPassword('test-password1');
  });
  afterAll(async () => {
    await app?.close();
    await server?.stop();
  });
  beforeEach(async () => {
    await Promise.all(
      Object.values(connection.collections).map((collection) =>
        collection.deleteMany({}),
      ),
    );
    const accounts = await users.create([
      {
        email: 'admin@example.com',
        fullName: 'Admin',
        roles: ['admin'],
        passwordHash,
      },
      { email: 'owner@example.com', fullName: 'Current Name', passwordHash },
      {
        email: 'mod@example.com',
        fullName: 'Mod',
        roles: ['hotel_moderator'],
        passwordHash,
      },
    ]);
    adminId = accounts[0]._id;
    ownerId = accounts[1]._id;
    admin = await signIn('admin@example.com');
    traveler = await signIn('owner@example.com');
    moderator = await signIn('mod@example.com');
  });
  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/login')
      .send({ email, password: 'test-password1' })
      .expect(200);
    return agent;
  }
  function booking(overrides: Partial<HotelBooking> = {}) {
    return bookings.create({
      userId: ownerId,
      guestName: 'Booked Guest',
      hotelId: new Types.ObjectId(),
      hotelName: 'Booked Hotel',
      reference: `HTL-${new Types.ObjectId()}`,
      status: 'Confirmed',
      checkIn: day(5),
      checkOut: day(8),
      nights: 3,
      rooms: [
        {
          roomId: new Types.ObjectId(),
          name: 'Double 1',
          type: 'Double',
          adults: 1,
          childrenAges: [7],
          pricePerNightMinor: 1000,
          subtotalMinor: 3000,
        },
      ],
      totalMinor: 3000,
      currency: 'USD',
      holdExpiresAt: new Date(Date.now() + 600000),
      policies: {
        checkInTime: '14:00',
        checkOutTime: '11:00',
        cancellationTiers: [],
      },
      ...overrides,
    });
  }
  function list(query: Record<string, unknown> = {}, agent = admin) {
    return agent.get('/api/admin/bookings').query({ type: 'hotel', ...query });
  }

  function flight(overrides: Partial<FlightBooking> = {}) {
    return flights.create({
      userId: ownerId,
      bookingReference: 'FLT-' + new Types.ObjectId(),
      status: 'Confirmed',
      segments: [
        {
          flightId: new Types.ObjectId(),
          airlineId: new Types.ObjectId(),
          airlineName: 'Booked Airline',
          flightNumber: 'GIU101',
          departureAirportCode: 'CAI',
          arrivalAirportCode: 'JFK',
          departureLocalDate: day(5),
          departureAt: new Date(day(5) + 'T12:00:00Z'),
          arrivalAt: new Date(day(5) + 'T20:00:00Z'),
          cabinCategory: 'Economy',
          seatsReserved: 1,
          baseFareMinor: 10_000,
          segmentTotalMinor: 10_000,
        },
      ],
      passengers: [
        {
          fullName: 'Private Passenger',
          dateOfBirth: new Date('1990-01-01'),
          passengerType: 'Adult',
          identityDocumentNumber: 'PRIVATE-PASSPORT',
          extraBags: 0,
          extraBaggageFeeMinor: 0,
        },
      ],
      totalAmountMinor: 10_000,
      currency: 'USD',
      holdExpiresAt: new Date(Date.now() + 600_000),
      policySnapshot: {
        type: 'flight',
        cancellation: [{ daysBefore: 0, refundPercent: 50 }],
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
      },
      ...overrides,
    });
  }

  it('requires an active unrestricted administrator', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/bookings?type=hotel')
      .expect(401);
    await list({}, traveler).expect(403);
    await list({}, moderator).expect(403);
    await users.updateOne(
      { _id: adminId },
      { $set: { mustChangePassword: true } },
    );
    await list().expect(403);
    await users.updateOne(
      { _id: adminId },
      { $set: { mustChangePassword: false, status: 'suspended' } },
    );
    await list().expect(401);
  });

  it('projects only required booking data with saved identities and nullable references', async () => {
    const target = await booking({
      status: 'Pending Payment',
      reference: undefined,
    });
    await bookings.collection.updateOne(
      { _id: target._id },
      {
        $set: {
          internalNote: 'controlled-private-field',
          paymentId: 'controlled-payment-link',
        },
      },
    );
    const response = await list()
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(response.body.data).toEqual([
      {
        id: target._id.toString(),
        type: 'hotel',
        reference: null,
        user: { id: ownerId.toString(), name: 'Booked Guest' },
        provider: { id: target.hotelId.toString(), name: 'Booked Hotel' },
        dates: { from: day(5), to: day(8) },
        amountMinor: 3000,
        currency: 'USD',
        status: 'Pending Payment',
        createdAt: target.createdAt.toISOString(),
      },
    ]);
    expect(JSON.stringify(response.body)).not.toMatch(
      /passwordHash|paymentId|internalNote|childrenAges|policies|holdExpiresAt/,
    );
  });

  it('paginates with a stable ID tie-breaker and consistent totals', async () => {
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const targets = [];
    for (let index = 0; index < 12; index++)
      targets.push(await booking({ createdAt }));
    const first = (await list().expect(200)).body;
    const second = (await list({ page: 2 }).expect(200)).body;
    expect(first.meta).toEqual({
      page: 1,
      limit: 10,
      total: 12,
      totalPages: 2,
    });
    expect(first.data).toHaveLength(10);
    expect(second.data).toHaveLength(2);
    expect(
      [...first.data, ...second.data].map((row: { id: string }) => row.id),
    ).toEqual(
      targets
        .map((row) => row._id.toString())
        .sort()
        .reverse(),
    );
    const empty = (await list({ page: 3 }).expect(200)).body;
    expect(empty.data).toEqual([]);
    expect(empty.meta.total).toBe(12);
  });

  it('combines status and inclusive booking-start date filters', async () => {
    const first = await booking({ checkIn: day(5), checkOut: day(8) });
    await booking({ checkIn: day(10), checkOut: day(12), status: 'Cancelled' });
    const last = await booking({ checkIn: day(15), checkOut: day(17) });
    const result = (
      await list({ status: 'Confirmed', from: day(5), to: day(15) }).expect(200)
    ).body;
    expect(result.meta.total).toBe(2);
    expect(new Set(result.data.map((row: { id: string }) => row.id))).toEqual(
      new Set([first._id.toString(), last._id.toString()]),
    );
    expect(
      (await list({ from: day(6), to: day(14) }).expect(200)).body.data[0]
        .status,
    ).toBe('Cancelled');
  });

  it('derives expiry/completion for filtering without mutating stored booking records', async () => {
    const expired = await booking({
      status: 'Pending Payment',
      holdExpiresAt: new Date(Date.now() - 1000),
    });
    const completed = await booking({ checkIn: day(-10), checkOut: day(-5) });
    const before = await bookings.find().sort({ _id: 1 }).lean();
    expect(
      (await list({ status: 'Expired' }).expect(200)).body.data[0].id,
    ).toBe(expired._id.toString());
    expect(
      (await list({ status: 'Completed' }).expect(200)).body.data[0].id,
    ).toBe(completed._id.toString());
    expect((await list({ status: 'Confirmed' }).expect(200)).body.data).toEqual(
      [],
    );
    expect(await bookings.find().sort({ _id: 1 }).lean()).toEqual(before);
  });

  it('returns available flight/combined lists when a domain is empty', async () => {
    await booking();
    expect(
      (await admin.get('/api/admin/bookings').expect(200)).body.meta.total,
    ).toBe(1);
    expect((await list({ type: 'flight' }).expect(200)).body.meta.total).toBe(
      0,
    );
    expect((await list().expect(200)).body.meta.total).toBe(1);
  });

  it('rejects invalid filters, ranges, pagination and operator/unknown fields', async () => {
    for (const query of [
      { type: 'train' },
      { status: 'Booked' },
      { page: 0 },
      { page: 1.2 },
      { page: Number.MAX_SAFE_INTEGER },
      { limit: 20 },
      { from: '2028-02-30' },
      { to: 'invalid' },
      { from: day(10), to: day(5) },
      { 'status[$ne]': 'Confirmed' },
    ]) {
      await list(query).expect(400);
    }
    expect((await list().expect(200)).body.meta).toEqual({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
  });

  it('documents filters, administrator cookie access and the sanitized result schema', async () => {
    const doc = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    const operation = doc.paths['/api/admin/bookings'].get;
    expect(
      operation.parameters.map((entry: { name: string }) => entry.name),
    ).toEqual(expect.arrayContaining(['type', 'status', 'from', 'to', 'page']));
    expect(operation.security).toBeDefined();
    expect(operation.responses['200']).toBeDefined();
    expect(
      doc.components.schemas.AdminBookingViewDto.properties.type.enum,
    ).toEqual(['hotel', 'flight']);
    expect(
      doc.components.schemas.AdminBookingViewDto.properties,
    ).toHaveProperty('provider');
    expect(
      doc.components.schemas.AdminBookingViewDto.properties,
    ).not.toHaveProperty('paymentId');
  });
  it('combines domains before a single global order, page and count', async () => {
    const rows: { id: string; type: string; timestamp: number }[] = [];
    for (let index = 0; index < 6; index++) {
      const hotelDate = new Date(Date.UTC(2030, 0, 1, 0, index * 2));
      const flightDate = new Date(hotelDate.getTime() + 60_000);
      const hotel = await booking({ createdAt: hotelDate });
      const air = await flight({ createdAt: flightDate });
      rows.push(
        {
          id: hotel._id.toString(),
          type: 'hotel',
          timestamp: hotelDate.getTime(),
        },
        {
          id: air._id.toString(),
          type: 'flight',
          timestamp: flightDate.getTime(),
        },
      );
    }
    const first = (await admin.get('/api/admin/bookings').expect(200)).body;
    const second = (await admin.get('/api/admin/bookings?page=2').expect(200))
      .body;
    expect(first.meta).toEqual({
      page: 1,
      limit: 10,
      total: 12,
      totalPages: 2,
    });
    expect(first.data).toHaveLength(10);
    expect(second.data).toHaveLength(2);
    expect(
      [...first.data, ...second.data].map(
        (row: { id: string; type: string }) => row.type + ':' + row.id,
      ),
    ).toEqual(
      rows
        .sort((a, b) => b.timestamp - a.timestamp)
        .map((row) => row.type + ':' + row.id),
    );
    expect((await list().expect(200)).body.meta.total).toBe(6);
    expect((await list({ type: 'flight' }).expect(200)).body.meta.total).toBe(
      6,
    );
  });
  it('uses type as a stable tie-breaker even when distinct collections share the same ID', async () => {
    const createdAt = new Date('2030-01-01T00:00:00Z');
    const hotel = await booking({ createdAt });
    await flight({ _id: hotel._id, createdAt });
    const result = (await admin.get('/api/admin/bookings').expect(200)).body;
    expect(result.meta.total).toBe(2);
    expect(result.data.map((row: { type: string }) => row.type)).toEqual([
      'flight',
      'hotel',
    ]);
  });
  it('positively projects flight data, current owner name and saved provider while hiding hold/payment/passenger data', async () => {
    const air = await flight({
      status: 'Pending Payment',
      bookingReference: 'HOLD-PRIVATE',
      paymentId: 'PRIVATE-PAYMENT',
    });
    const result = await list({ type: 'flight' })
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(result.body.data).toEqual([
      {
        id: air._id.toString(),
        type: 'flight',
        reference: null,
        user: { id: ownerId.toString(), name: 'Current Name' },
        provider: {
          id: air.segments[0].airlineId.toString(),
          name: 'Booked Airline',
        },
        dates: { from: day(5), to: day(5) },
        amountMinor: 10_000,
        currency: 'USD',
        status: 'Pending Payment',
        createdAt: air.createdAt.toISOString(),
      },
    ]);
    expect(JSON.stringify(result.body)).not.toMatch(
      /PRIVATE|password|passengers|policy|payment|holdExpiresAt|dateOfBirth|email|roles/,
    );
    await flights.updateOne(
      { _id: air._id },
      { $set: { userId: new Types.ObjectId() } },
    );
    expect(
      (await list({ type: 'flight' }).expect(200)).body.data[0].user.name,
    ).toBe('Deleted user');
  });
  it('applies combined status/start-date filters to flight local dates and hotel check-in dates inclusively', async () => {
    const hotel = await booking();
    const air = await flight();
    const segments = air
      .toObject()
      .segments.map((segment) => ({
        ...segment,
        departureLocalDate: day(15),
        departureAt: new Date(day(15) + 'T12:00:00Z'),
        arrivalAt: new Date(day(15) + 'T20:00:00Z'),
      }));
    const later = await flight({ segments });
    await booking({ status: 'Cancelled', checkIn: day(10), checkOut: day(12) });
    const result = (
      await admin
        .get('/api/admin/bookings')
        .query({ status: 'Confirmed', from: day(5), to: day(15) })
        .expect(200)
    ).body;
    expect(result.meta.total).toBe(3);
    expect(new Set(result.data.map((row: { id: string }) => row.id))).toEqual(
      new Set([hotel._id.toString(), air._id.toString(), later._id.toString()]),
    );
    expect(
      (
        await admin
          .get('/api/admin/bookings')
          .query({ from: day(5), to: day(5) })
          .expect(200)
      ).body.meta.total,
    ).toBe(2);
  });
  it('derives flight expiry/completion without modifying either collection or releasing counters', async () => {
    const expired = await flight({
      status: 'Pending Payment',
      holdExpiresAt: new Date(Date.now() - 1000),
    });
    const completed = await flight();
    await flights.updateOne(
      { _id: completed._id },
      {
        $set: {
          'segments.0.departureAt': new Date(Date.now() - 86_400_000),
          'segments.0.arrivalAt': new Date(Date.now() - 1000),
        },
      },
    );
    const beforeFlights = await flights.find().sort({ _id: 1 }).lean();
    const beforeHotels = await bookings.find().lean();
    expect(
      (await admin.get('/api/admin/bookings?status=Expired').expect(200)).body
        .data[0].id,
    ).toBe(expired._id.toString());
    expect(
      (await admin.get('/api/admin/bookings?status=Completed').expect(200)).body
        .data[0].id,
    ).toBe(completed._id.toString());
    expect(await flights.find().sort({ _id: 1 }).lean()).toEqual(beforeFlights);
    expect(await bookings.find().lean()).toEqual(beforeHotels);
  });
  it('denies non-admin access to the newly combined and flight views', async () => {
    await users.create({
      email: 'airline@example.com',
      fullName: 'Airline Mod',
      roles: ['airline_moderator'],
      passwordHash,
    });
    const airlineMod = await signIn('airline@example.com');
    for (const agent of [traveler, moderator, airlineMod]) {
      await agent.get('/api/admin/bookings').expect(403);
      await agent.get('/api/admin/bookings?type=flight').expect(403);
    }
    await request(app.getHttpServer()).get('/api/admin/bookings').expect(401);
  });

  it('uses the outbound local date and waits for final round-trip arrival before displaying Completed', async () => {
    const air = await flight();
    const outbound = air.toObject().segments[0];
    await flights.updateOne(
      { _id: air._id },
      {
        $set: {
          totalAmountMinor: 20_000,
          segments: [
            {
              ...outbound,
              departureAt: new Date(day(4) + 'T22:30:00Z'),
              departureLocalDate: day(5),
            },
            {
              ...outbound,
              flightId: new Types.ObjectId(),
              flightNumber: 'GIU102',
              departureAirportCode: 'JFK',
              arrivalAirportCode: 'CAI',
              departureLocalDate: day(10),
              departureAt: new Date(day(10) + 'T17:00:00Z'),
              arrivalAt: new Date(day(11) + 'T00:30:00Z'),
            },
          ],
        },
      },
    );
    const result = (
      await list({ type: 'flight', from: day(5), to: day(5) }).expect(200)
    ).body;
    expect(result.data[0]).toMatchObject({
      id: air._id.toString(),
      dates: { from: day(5), to: day(11) },
      amountMinor: 20_000,
      status: 'Confirmed',
    });
    await flights.updateOne(
      { _id: air._id },
      {
        $set: {
          'segments.0.departureAt': new Date(Date.now() - 2 * 86_400_000),
          'segments.0.arrivalAt': new Date(Date.now() - 86_400_000),
        },
      },
    );
    expect(
      (await list({ type: 'flight', status: 'Completed' }).expect(200)).body
        .meta.total,
    ).toBe(0);
    expect(
      (await list({ type: 'flight', status: 'Confirmed' }).expect(200)).body
        .meta.total,
    ).toBe(1);
  });
});
