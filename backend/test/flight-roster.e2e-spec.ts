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
import { Connection, Model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { parse } from 'csv-parse/sync';
import request from 'supertest';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { ModeratorAssignment } from '../src/modules/administration/schemas/moderator-assignment.schema';
import { Airline } from '../src/modules/airlines/schemas/airline.schema';
import { hashPassword } from '../src/modules/auth/security/password';
import { FlightBooking } from '../src/modules/flight-bookings/schemas/flight-booking.schema';
import { FlightsModule } from '../src/modules/flights/flights.module';
import { Flight } from '../src/modules/flights/schemas/flight.schema';
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

describe('FLT-29 assigned flight roster and all-passenger CSV (actual HTTP/MongoDB)', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryReplSet, app: INestApplication, connection: Connection;
  let users: Model<User>,
    airlines: Model<Airline>,
    flights: Model<Flight>,
    bookings: Model<FlightBooking>,
    assignments: Model<ModeratorAssignment>;
  let mod: Agent,
    otherMod: Agent,
    traveler: Agent,
    hotelMod: Agent,
    admin: Agent;
  let modId: Types.ObjectId,
    ownerId: Types.ObjectId,
    airlineId: Types.ObjectId,
    otherAirlineId: Types.ObjectId,
    flightId: Types.ObjectId,
    returnId: Types.ObjectId;
  let passwordHash: string;
  const date = (days: number) => new Date(Date.now() + days * 86_400_000);
  const cabin = {
    category: 'Economy',
    totalSeats: 20,
    bookedSeats: 0,
    heldSeats: 0,
    price: 1000,
    freeBags: 1,
    maxWeightPerBag: 23,
  };

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      instanceOpts: [{ launchTimeout: 30_000 }],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), {
          dbName: 'giu_flight_roster',
        }),
        FlightsModule,
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
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('Roster')
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
    airlines = app.get(getModelToken(Airline.name));
    flights = app.get(getModelToken(Flight.name));
    bookings = app.get(getModelToken(FlightBooking.name));
    assignments = app.get(getModelToken(ModeratorAssignment.name));
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    passwordHash = await hashPassword('roster-password1');
  });
  beforeEach(async () => {
    await Promise.all(
      Object.values(connection.collections).map((collection) =>
        collection.deleteMany({}),
      ),
    );
    const accounts = await users.create([
      {
        email: 'mod@example.com',
        fullName: 'Assigned',
        roles: ['airline_moderator'],
        passwordHash,
      },
      {
        email: 'other-mod@example.com',
        fullName: 'Other',
        roles: ['airline_moderator'],
        passwordHash,
      },
      { email: 'traveler@example.com', fullName: 'Traveler', passwordHash },
      {
        email: 'hotel-mod@example.com',
        fullName: 'Hotel Moderator',
        roles: ['hotel_moderator'],
        passwordHash,
      },
      {
        email: 'admin@example.com',
        fullName: 'Admin',
        roles: ['admin'],
        passwordHash,
      },
    ]);
    modId = accounts[0]._id;
    ownerId = accounts[2]._id;
    const providers = await airlines.create([
      { name: 'Airline A', code: 'AA', logoUrl: 'https://example.com/a.png' },
      { name: 'Airline B', code: 'BB', logoUrl: 'https://example.com/b.png' },
    ]);
    airlineId = providers[0]._id;
    otherAirlineId = providers[1]._id;
    await assignments.create([
      {
        userId: modId,
        providerType: 'airline',
        providerId: airlineId,
        assignedBy: accounts[4]._id,
      },
      {
        userId: accounts[1]._id,
        providerType: 'airline',
        providerId: otherAirlineId,
        assignedBy: accounts[4]._id,
      },
    ]);
    const planes = await flights.create([
      {
        airlineId,
        flightNumber: 'AA1',
        departureAirportId: 'CAI',
        arrivalAirportId: 'JFK',
        departureAt: date(5),
        arrivalAt: date(6),
        departureLocalDate: date(5).toISOString().slice(0, 10),
        cabins: [cabin],
      },
      {
        airlineId: otherAirlineId,
        flightNumber: 'BB1',
        departureAirportId: 'JFK',
        arrivalAirportId: 'CAI',
        departureAt: date(8),
        arrivalAt: date(9),
        departureLocalDate: date(8).toISOString().slice(0, 10),
        cabins: [{ ...cabin, category: 'Business' }],
      },
    ]);
    flightId = planes[0]._id;
    returnId = planes[1]._id;
    mod = await login('mod@example.com');
    otherMod = await login('other-mod@example.com');
    traveler = await login('traveler@example.com');
    hotelMod = await login('hotel-mod@example.com');
    admin = await login('admin@example.com');
  });
  afterAll(async () => {
    await app?.close();
    await server?.stop();
  });
  async function login(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/login')
      .send({ email, password: 'roster-password1' })
      .expect(200);
    return agent;
  }
  async function reserve(
    names = ['Passenger'],
    status: FlightBooking['status'] = 'Confirmed',
    roundTrip = false,
    expires = date(1),
  ) {
    const segments = [
      {
        flightId,
        airlineId,
        airlineName: 'Airline A',
        flightNumber: 'AA1',
        departureAirportCode: 'CAI',
        arrivalAirportCode: 'JFK',
        departureAt: date(5),
        arrivalAt: date(6),
        departureLocalDate: date(5).toISOString().slice(0, 10),
        cabinCategory: 'Economy',
        seatsReserved: names.length,
        baseFareMinor: names.length * 1000,
        segmentTotalMinor: names.length * 1000,
      },
    ];
    if (roundTrip)
      segments.push({
        ...segments[0],
        flightId: returnId,
        airlineId: otherAirlineId,
        airlineName: 'Airline B',
        flightNumber: 'BB1',
        departureAirportCode: 'JFK',
        arrivalAirportCode: 'CAI',
        departureAt: date(8),
        arrivalAt: date(9),
        departureLocalDate: date(8).toISOString().slice(0, 10),
        cabinCategory: 'Business',
      });
    const booking = await bookings.create({
      userId: ownerId,
      bookingReference:
        (status === 'Pending Payment' ? 'HOLD-' : 'FLT-') +
        new Types.ObjectId(),
      status,
      segments,
      passengers: names.map((fullName) => ({
        fullName,
        dateOfBirth: new Date('1990-01-01'),
        passengerType: 'Adult',
        identityDocumentNumber: 'PRIVATE-PASSPORT',
        extraBags: 0,
        extraBaggageFeeMinor: 0,
      })),
      totalAmountMinor: names.length * segments.length * 1000,
      currency: 'USD',
      holdExpiresAt: expires,
      paymentId: 'PRIVATE-PAYMENT',
      policySnapshot: {
        type: 'flight',
        cancellation: [],
        baggage: segments.map((segment) => ({
          segmentId: segment.flightId.toString(),
          cabin: segment.cabinCategory,
          freeBagCount: 1,
          maxWeightKg: 23,
          extraBagPriceMinor: 2500,
          maxExtraBags: 2,
        })),
      },
    });
    if (['Confirmed', 'Completed', 'Pending Payment'].includes(status))
      for (const segment of segments)
        await flights.updateOne(
          { _id: segment.flightId, 'cabins.category': segment.cabinCategory },
          {
            $inc: {
              ['cabins.$.' +
              (status === 'Pending Payment' ? 'heldSeats' : 'bookedSeats')]:
                names.length,
            },
          },
        );
    return booking;
  }
  const path = () => '/api/flights/' + flightId + '/bookings';
  const csvPath = () => '/api/flights/' + flightId + '/passengers/export';

  it('returns required own-flight names/reference/cabin/status and remaining seats only', async () => {
    const confirmed = await reserve(['First', 'Second']);
    await reserve(['Cancelled Passenger'], 'Cancelled');
    await reserve(['Pending Passenger'], 'Pending Payment');
    const response = await mod
      .get(path())
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(response.body.meta).toEqual({
      page: 1,
      limit: 10,
      total: 2,
      totalPages: 1,
    });
    expect(
      response.body.data.find(
        (row: { bookingId: string }) =>
          row.bookingId === confirmed._id.toString(),
      ),
    ).toMatchObject({
      passengerNames: ['First', 'Second'],
      cabinCategory: 'Economy',
      seatsReserved: 2,
      status: 'Confirmed',
    });
    expect(response.body.flight.cabins[0]).toMatchObject({
      totalSeats: 20,
      bookedSeats: 2,
      heldSeats: 1,
      availableSeats: 17,
    });
    expect(JSON.stringify(response.body)).not.toMatch(
      /PRIVATE|identityDocument|dateOfBirth|paymentId|policySnapshot|email|password|userId/,
    );
  });
  it('scopes every page/export to the actual assigned provider and the matching round-trip segment', async () => {
    await reserve(['Round Trip'], 'Confirmed', true);
    await otherMod.get(path()).expect(403);
    await otherMod.get(csvPath()).expect(403);
    const back = (
      await otherMod.get('/api/flights/' + returnId + '/bookings').expect(200)
    ).body;
    expect(back.data[0]).toMatchObject({
      cabinCategory: 'Business',
      passengerNames: ['Round Trip'],
      seatsReserved: 1,
    });
    expect(back.flight.id).toBe(returnId.toString());
  });
  it('paginates bookings while CSV exports every passenger across all pages', async () => {
    for (let index = 0; index < 11; index++)
      await reserve(['Passenger ' + index]);
    const first = (await mod.get(path()).expect(200)).body;
    const second = (await mod.get(path() + '?page=2').expect(200)).body;
    expect(first.meta).toEqual({
      page: 1,
      limit: 10,
      total: 11,
      totalPages: 2,
    });
    expect(first.data).toHaveLength(10);
    expect(second.data).toHaveLength(1);
    const csv = await mod
      .get(csvPath())
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect('X-Content-Type-Options', 'nosniff');
    expect(csv.headers['content-type']).toMatch(/^text\/csv/);
    expect(csv.headers['content-disposition']).toContain(
      'attachment; filename="flight-' + flightId + '-passengers.csv"',
    );
    const records = parse(csv.text, { bom: true, columns: true }) as Record<
      string,
      string
    >[];
    expect(records).toHaveLength(11);
    expect(new Set(records.map((r) => r.passengerName)).size).toBe(11);
  });
  it('preserves Unicode/quotes/newlines and neutralizes spreadsheet formulas without exposing other data', async () => {
    await reserve([
      '=2+2',
      '+SUM(1,1)',
      '-10+5',
      '@SUM(1)',
      'Line "quote", comma\nSecond',
      '\u0623\u062d\u0645\u062f \u0645\u062d\u0645\u062f',
    ]);
    const response = await mod.get(csvPath()).expect(200);
    const records = parse(response.text, {
      bom: true,
      columns: true,
    }) as Record<string, string>[];
    expect(records.map((r) => r.passengerName)).toEqual([
      "'=2+2",
      "'+SUM(1,1)",
      "'-10+5",
      "'@SUM(1)",
      'Line "quote", comma\nSecond',
      '\u0623\u062d\u0645\u062f \u0645\u062d\u0645\u062f',
    ]);
    expect(Object.keys(records[0])).toEqual([
      'bookingReference',
      'passengerName',
      'cabinCategory',
      'status',
    ]);
    expect(response.text).not.toMatch(
      /PRIVATE|identityDocument|dateOfBirth|paymentId|policySnapshot|email|password/,
    );
  });
  it('requires an active unrestricted airline moderator and validates IDs/pages/operator fields', async () => {
    for (const url of [path(), csvPath()]) {
      await request(app.getHttpServer()).get(url).expect(401);
      for (const agent of [traveler, hotelMod, admin])
        await agent.get(url).expect(403);
    }
    await mod.get(path() + '?page=0').expect(400);
    await mod.get(path() + '?page[$gt]=1').expect(400);
    await mod.get(path() + '?ownerId=' + ownerId).expect(400);
    await mod.get('/api/flights/invalid/bookings').expect(400);
    await mod
      .get('/api/flights/' + new Types.ObjectId() + '/bookings')
      .expect(404);
    await users.updateOne(
      { _id: modId },
      { $set: { mustChangePassword: true } },
    );
    await mod.get(path()).expect(403);
    await users.updateOne(
      { _id: modId },
      { $set: { mustChangePassword: false, status: 'suspended' } },
    );
    await mod.get(csvPath()).expect(401);
  });
  it('keeps paid history readable for an inactive airline and past/completed flights', async () => {
    await reserve(['History'], 'Completed');
    await airlines.updateOne(
      { _id: airlineId },
      { $set: { status: 'deactivated' } },
    );
    await flights.updateOne(
      { _id: flightId },
      { $set: { departureAt: new Date(Date.now() - 1000) } },
    );
    const response = (await mod.get(path()).expect(200)).body;
    expect(response.flight.status).toBe('Departed');
    expect(response.data[0]).toMatchObject({
      passengerNames: ['History'],
      status: 'Confirmed',
    });
  });
  it('checks assignment before expiry reconciliation and never exports pending/expired passengers', async () => {
    const pending = await reserve(
      ['Unpaid'],
      'Pending Payment',
      false,
      new Date(Date.now() - 1000),
    );
    await otherMod.get(path()).expect(403);
    expect((await bookings.findById(pending._id).orFail()).status).toBe(
      'Pending Payment',
    );
    const own = (await mod.get(path()).expect(200)).body;
    expect(own.data).toEqual([]);
    expect(own.flight.cabins[0].heldSeats).toBe(0);
    expect((await bookings.findById(pending._id).orFail()).status).toBe(
      'Expired',
    );
    expect(
      parse((await mod.get(csvPath()).expect(200)).text, {
        bom: true,
        columns: true,
      }),
    ).toEqual([]);
  });
  it('documents protected roster and binary CSV download routes', async () => {
    const doc = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    for (const route of [
      '/api/flights/{id}/bookings',
      '/api/flights/{id}/passengers/export',
    ])
      expect(doc.paths[route].get.security).toContainEqual({ giu_session: [] });
    expect(
      doc.paths['/api/flights/{id}/passengers/export'].get.responses['200']
        .content['text/csv'].schema,
    ).toEqual({ type: 'string', format: 'binary' });
  });
});
