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
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { Connection, Model, Types } from 'mongoose';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative, resolve } from 'node:path';
import request from 'supertest';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { hashPassword } from '../src/modules/auth/security/password';
import { FlightBookingsModule } from '../src/modules/flight-bookings/flight-bookings.module';
import { FlightBooking } from '../src/modules/flight-bookings/schemas/flight-booking.schema';
import { seedOfficialReferences } from '../src/modules/reference-data/reference-seed';
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

function extract(buffer: Buffer): { text: string; pages: number } {
  const result = spawnSync(
    process.execPath,
    [join(__dirname, 'helpers/parse-pdf.cjs')],
    {
      input: buffer,
      encoding: 'utf8',
      timeout: 15_000,
      maxBuffer: 2 * 1024 * 1024,
      windowsHide: true,
    },
  );
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error('Independent PDF parser failed: ' + result.stderr);
  const parsed = JSON.parse(result.stdout) as { text: unknown; pages: unknown };
  if (
    typeof parsed.text !== 'string' ||
    typeof parsed.pages !== 'number' ||
    !Number.isInteger(parsed.pages) ||
    parsed.pages < 1
  )
    throw new Error('Unexpected PDF parser output');
  return { text: parsed.text, pages: parsed.pages };
}
/** Optional synthetic HTTP downloads for local Poppler visual QA; never writes outside temp. */
function keepQa(name: string, bytes: Buffer) {
  if (!process.env.GIU_ETICKET_QA_DIR) return;
  const directory = resolve(process.env.GIU_ETICKET_QA_DIR),
    pathFromTemp = relative(tmpdir(), directory);
  if (
    !pathFromTemp ||
    pathFromTemp.startsWith('..') ||
    isAbsolute(pathFromTemp)
  )
    throw new Error('QA output must be inside a dedicated temp directory');
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, name + '.pdf'), bytes);
}

describe('FLT-23 private PDF e-ticket (actual HTTP/database and independent PDF parsing)', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryReplSet, app: INestApplication, connection: Connection;
  let users: Model<User>, bookings: Model<FlightBooking>;
  let owner: Agent,
    other: Agent,
    admin: Agent,
    moderator: Agent,
    hotelModerator: Agent;
  let ownerId: Types.ObjectId, passwordHash: string;
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      instanceOpts: [{ launchTimeout: 30_000 }],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), {
          dbName: 'giu_flight_eticket',
        }),
        FlightBookingsModule,
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
          .setTitle('E-ticket')
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
    bookings = app.get(getModelToken(FlightBooking.name));
    await seedOfficialReferences(connection);
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    passwordHash = await hashPassword('ticket-password1');
  });
  beforeEach(async () => {
    await users.deleteMany({});
    await bookings.deleteMany({});
    const accounts = await users.create([
      { email: 'owner@example.com', fullName: 'Owner', passwordHash },
      { email: 'other@example.com', fullName: 'Other', passwordHash },
      {
        email: 'admin@example.com',
        fullName: 'Admin',
        roles: ['admin'],
        passwordHash,
      },
      {
        email: 'moderator@example.com',
        fullName: 'Airline Moderator',
        roles: ['airline_moderator'],
        passwordHash,
      },
      {
        email: 'hotel@example.com',
        fullName: 'Hotel Moderator',
        roles: ['hotel_moderator'],
        passwordHash,
      },
    ]);
    ownerId = accounts[0]._id;
    owner = await login('owner@example.com');
    other = await login('other@example.com');
    admin = await login('admin@example.com');
    moderator = await login('moderator@example.com');
    hotelModerator = await login('hotel@example.com');
  });
  afterAll(async () => {
    await app?.close();
    await server?.stop();
  });
  async function login(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/login')
      .send({ email, password: 'ticket-password1' })
      .expect(200);
    return agent;
  }
  async function fixture(
    status: FlightBooking['status'] = 'Confirmed',
    roundTrip = false,
    names = ['Test Passenger'],
  ) {
    const segments = [
      {
        flightId: new Types.ObjectId(),
        airlineId: new Types.ObjectId(),
        airlineName: 'Synthetic Airline',
        flightNumber: 'AA123',
        departureAirportCode: 'CAI',
        arrivalAirportCode: 'JFK',
        departureAt: new Date('2027-04-01T10:00:00Z'),
        arrivalAt: new Date('2027-04-01T22:00:00Z'),
        departureLocalDate: '2027-04-01',
        cabinCategory: 'Economy',
        seatsReserved: names.length,
        baseFareMinor: 12345,
        segmentTotalMinor: 12345,
      },
    ];
    if (roundTrip)
      segments.push({
        ...segments[0],
        flightId: new Types.ObjectId(),
        airlineId: new Types.ObjectId(),
        airlineName: 'Return Airline',
        flightNumber: 'BB321',
        departureAirportCode: 'JFK',
        arrivalAirportCode: 'CAI',
        departureAt: new Date('2027-04-12T10:00:00Z'),
        arrivalAt: new Date('2027-04-12T20:00:00Z'),
        departureLocalDate: '2027-04-12',
        cabinCategory: 'Business',
      });
    return bookings.create({
      userId: ownerId,
      bookingReference: 'FLT-QA-' + new Types.ObjectId().toString(),
      status,
      segments,
      passengers: names.map((fullName) => ({
        fullName,
        dateOfBirth: new Date('1990-05-10'),
        passengerType: 'Adult',
        identityDocumentNumber: 'PRIVATE-PASSPORT-NUMBER',
        extraBags: 1,
        extraBagWeightsKg: [12],
        extraBaggageFeeMinor: 2500,
      })),
      totalAmountMinor: 12345,
      currency: 'USD',
      holdExpiresAt: new Date('2027-04-01T09:00:00Z'),
      paymentId: 'PRIVATE-PAYMENT-ID',
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
  }
  const url = (id: Types.ObjectId | string) =>
    '/api/flight-bookings/' + id + '/e-ticket';
  async function download(id: Types.ObjectId | string) {
    const response = await owner
      .get(url(id))
      .expect(200)
      .expect('Content-Type', /^application\/pdf/)
      .expect('Cache-Control', 'no-store')
      .expect('X-Content-Type-Options', 'nosniff');
    return response;
  }

  it('downloads a valid private PDF with reference, local schedule, saved baggage and exact total', async () => {
    const booking = await fixture();
    const response = await download(booking._id);
    expect(response.headers['content-disposition']).toContain(
      'attachment; filename="flight-' + booking._id + '-eticket.pdf"',
    );
    const bytes = response.body as Buffer;
    expect(Buffer.isBuffer(bytes)).toBe(true);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    keepQa('one-way', bytes);
    const parsed = await extract(bytes);
    for (const text of [
      booking.bookingReference,
      'Test Passenger',
      'AA123',
      'Economy',
      '2027-04-01 12:00 +02:00',
      'Africa/Cairo',
      '2027-04-01 18:00 -04:00',
      'America/New_York',
      'Included bags per passenger: 1',
      'Maximum per bag: 23 kg',
      'Declared weights: 12 kg',
      'USD 123.45',
    ])
      expect(parsed.text).toContain(text);
    expect(parsed.text).not.toMatch(
      /PRIVATE|1990-05-10|owner@example.com|password|paymentId|identityDocument/,
    );
    keepQa('one-way', bytes);
  });
  it('rejects guests, other travelers and every non-traveler role without disclosing an owned ticket', async () => {
    const booking = await fixture();
    await request(app.getHttpServer()).get(url(booking._id)).expect(401);
    await other.get(url(booking._id)).expect(404);
    for (const agent of [admin, moderator, hotelModerator])
      await agent.get(url(booking._id)).expect(403);
    await owner.get(url('invalid')).expect(400);
    await owner.get(url(new Types.ObjectId())).expect(404);
  });
  it('requires confirmation and keeps expired/cancelled/unpaid tickets unavailable', async () => {
    for (const state of ['Pending Payment', 'Expired', 'Cancelled'] as const) {
      const booking = await fixture(state);
      await owner.get(url(booking._id)).expect(409);
    }
  });
  it('keeps completed paid history downloadable without mutating the booking or requiring an active provider', async () => {
    const booking = await fixture('Completed');
    const before = await bookings.findById(booking._id).lean();
    const response = await download(booking._id);
    expect((await extract(response.body as Buffer)).text).toContain(
      booking.bookingReference,
    );
    expect(await bookings.findById(booking._id).lean()).toEqual(before);
  });
  it('includes both round-trip segments and all passengers across numbered pages', async () => {
    const names = Array.from(
      { length: 18 },
      (_, index) =>
        'Passenger ' +
        String(index + 1).padStart(2, '0') +
        ' ' +
        'Long Family Name '.repeat(6),
    );
    const booking = await fixture('Confirmed', true, names);
    const response = await download(booking._id);
    const parsed = await extract(response.body as Buffer);
    expect(parsed.pages).toBeGreaterThan(2);
    for (const value of [
      'AA123',
      'BB321',
      'Return Airline',
      'Business',
      'Passenger 01',
      'Passenger 18',
    ])
      expect(parsed.text).toContain(value);
    for (let page = 1; page <= parsed.pages; page++)
      expect(parsed.text).toContain('Page ' + page + ' of ' + parsed.pages);
    keepQa('round-trip-many-passengers', response.body as Buffer);
  });
  it('embeds fonts for accented Latin and Arabic names and wraps the maximum passenger name', async () => {
    const names = [
      'Zo\u00eb Caf\u00e9',
      '\u0623\u062d\u0645\u062f \u0645\u062d\u0645\u062f',
      'A'.repeat(150),
    ];
    const booking = await fixture('Confirmed', true, names);
    const response = await download(booking._id);
    keepQa('unicode-long-names', response.body as Buffer);
    const parsed = await extract(response.body as Buffer);
    expect(parsed.text).toContain(names[0]);
    expect(parsed.text).toContain(names[1]);
    expect(parsed.text.replace(/\s/g, '')).toContain(names[2]);
    expect((response.body as Buffer).toString('latin1')).toMatch(/\/FontFile2/);
    keepQa('unicode-long-names', response.body as Buffer);
  });
  it('enforces password-change and inactive-account restrictions before rendering', async () => {
    const booking = await fixture();
    await users.updateOne(
      { _id: ownerId },
      { $set: { mustChangePassword: true } },
    );
    await owner.get(url(booking._id)).expect(403);
    await users.updateOne(
      { _id: ownerId },
      { $set: { mustChangePassword: false, status: 'suspended' } },
    );
    await owner.get(url(booking._id)).expect(401);
  });
  it('documents cookie protection, unavailable booking states and the PDF attachment', async () => {
    const doc = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    const operation = doc.paths['/api/flight-bookings/{id}/e-ticket'].get;
    expect(operation.security).toContainEqual({ giu_session: [] });
    expect(
      operation.responses['200'].content['application/pdf'].schema,
    ).toEqual({ type: 'string', format: 'binary' });
    expect(operation.responses['404']).toBeDefined();
    expect(operation.responses['409']).toBeDefined();
  });
});
