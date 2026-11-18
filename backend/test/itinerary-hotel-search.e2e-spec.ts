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
import request from 'supertest';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { hashPassword } from '../src/modules/auth/security/password';
import { HotelBookingsModule } from '../src/modules/hotel-bookings/hotel-bookings.module';
import { HotelBooking } from '../src/modules/hotel-bookings/schemas/hotel-booking.schema';
import { Hotel } from '../src/modules/hotels/schemas/hotel.schema';
import { HotelRoom } from '../src/modules/hotels/schemas/room.schema';
import { addDays, todayUtc } from '../src/modules/hotels/stay-rules';
import { ItinerariesModule } from '../src/modules/itineraries/itineraries.module';
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
type Trip = { id: string; days: { id: string }[] };
const day = (offset: number) => addDays(todayUtc(), offset);

describe('ITN-25 owned city-group search through the real hotel service', () => {
  jest.setTimeout(180_000);
  let app: INestApplication;
  let server: MongoMemoryReplSet;
  let connection: Connection;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let rooms: Model<HotelRoom>;
  let bookings: Model<HotelBooking>;
  let owner: Agent;
  let other: Agent;
  let staff: Agent;
  let trip: Trip;
  let hotelId: string;
  let otherHotelId: string;
  let firstRoomId: string;
  let passwordHash: string;

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), {
          dbName: 'giu_itinerary_hotel_search',
        }),
        ItinerariesModule,
        HotelBookingsModule,
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
    hotels = app.get(getModelToken(Hotel.name));
    rooms = app.get(getModelToken(HotelRoom.name));
    bookings = app.get(getModelToken(HotelBooking.name));
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
    await users.create([
      { email: 'owner@example.com', fullName: 'Owner', passwordHash },
      { email: 'other@example.com', fullName: 'Other', passwordHash },
      {
        email: 'staff@example.com',
        fullName: 'Staff',
        roles: ['admin'],
        passwordHash,
      },
    ]);
    owner = await signIn('owner@example.com');
    other = await signIn('other@example.com');
    staff = await signIn('staff@example.com');
    trip = (
      await owner
        .post('/api/itineraries')
        .send({
          title: 'City groups',
          countryCodes: ['EG', 'FR'],
          startDate: day(5),
        })
        .expect(201)
    ).body;
    for (const cityId of ['cairo', 'cairo', 'paris', 'cairo']) {
      trip = (
        await owner
          .post(`/api/itineraries/${trip.id}/days`)
          .send({ cityId })
          .expect(201)
      ).body;
    }
    const first = await addHotel('Alpha', 'cairo', 1000);
    hotelId = first.hotelId;
    firstRoomId = first.roomId;
    otherHotelId = (await addHotel('Beta', 'cairo', 2000, 6)).hotelId;
    await addHotel('Paris', 'paris', 3000);
    await hotels.updateOne(
      { _id: hotelId },
      { $set: { ratingCount: 2, ratingSum: 8 } },
    );
    await rooms.create({
      hotelId,
      name: 'Second',
      type: 'Double',
      beds: 1,
      maxOccupancy: 2,
      pricePerNightMinor: 1800,
      availability: [{ from: day(0), to: day(60) }],
    });
  });
  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/login')
      .send({ email, password: 'test-password1' })
      .expect(200);
    return agent;
  }
  async function addHotel(
    name: string,
    cityId: string,
    price: number,
    capacity = 2,
  ) {
    const hotel = await hotels.create({
      name,
      address: '1 Street',
      cityId,
      countryCode: cityId === 'paris' ? 'FR' : 'EG',
      starRating: 4,
    });
    const room = await rooms.create({
      hotelId: hotel._id,
      name: 'First',
      type: 'Double',
      beds: 1,
      maxOccupancy: capacity,
      pricePerNightMinor: price,
      availability: [{ from: day(0), to: day(60) }],
    });
    return { hotelId: hotel._id.toString(), roomId: room._id.toString() };
  }
  function search(query: Record<string, string | number> = {}, agent = owner) {
    return agent
      .get(`/api/itineraries/${trip.id}/hotels`)
      .query({ dayId: trip.days[1].id, guests: 2, ...query });
  }

  it('derives the whole consecutive group and exactly reuses hotel search results', async () => {
    const response = await search()
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(response.body.selection).toEqual({
      cityId: 'cairo',
      firstDayNumber: 1,
      dayCount: 2,
      checkIn: day(5),
      checkOut: day(7),
    });
    const direct = await request(app.getHttpServer())
      .get('/api/hotels/search')
      .query({ cityId: 'cairo', checkIn: day(5), checkOut: day(7), guests: 2 })
      .expect(200);
    expect(response.body.data).toEqual(direct.body.data);
    expect(response.body.meta).toEqual(direct.body.meta);
    const later = await search({ dayId: trip.days[3].id }).expect(200);
    expect(later.body.selection).toMatchObject({
      firstDayNumber: 4,
      dayCount: 1,
      checkIn: day(8),
      checkOut: day(9),
    });
    const paris = await search({ dayId: trip.days[2].id }).expect(200);
    expect(paris.body.data.map((row: { name: string }) => row.name)).toEqual([
      'Paris',
    ]);
  });

  it('uses current dates and groups after itinerary edits and reordering', async () => {
    await owner
      .patch(`/api/itineraries/${trip.id}`)
      .send({ startDate: day(10) })
      .expect(200);
    await owner
      .patch(`/api/itineraries/${trip.id}/days/reorder`)
      .send({
        dayIds: [
          trip.days[0].id,
          trip.days[1].id,
          trip.days[3].id,
          trip.days[2].id,
        ],
      })
      .expect(200);
    const response = await search({ dayId: trip.days[3].id }).expect(200);
    expect(response.body.selection).toMatchObject({
      dayCount: 3,
      checkIn: day(10),
      checkOut: day(13),
    });
    await owner
      .delete(`/api/itineraries/${trip.id}/days/${trip.days[3].id}`)
      .expect(200);
    await search({ dayId: trip.days[3].id }).expect(404);
    expect((await search().expect(200)).body.selection.dayCount).toBe(2);
  });

  it('reuses real holds, expiry, active providers and multi-room capacity rules', async () => {
    expect(
      (await search({ rooms: 2, guests: 4 }).expect(200)).body.data.map(
        (row: { id: string }) => row.id,
      ),
    ).toEqual([hotelId]);
    const hold = await other
      .post('/api/hotel-bookings')
      .send({
        hotelId,
        checkIn: day(5),
        checkOut: day(7),
        rooms: [{ roomId: firstRoomId, adults: 1 }],
      })
      .expect(201);
    expect(
      (await search({ rooms: 2, guests: 4 }).expect(200)).body.data,
    ).toEqual([]);
    expect(
      (await search({ guests: 3 }).expect(200)).body.data.map(
        (row: { id: string }) => row.id,
      ),
    ).toEqual([otherHotelId]);
    await bookings.updateOne(
      { _id: hold.body.id },
      { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
    );
    expect(
      (await search({ rooms: 2, guests: 4 }).expect(200)).body.data.map(
        (row: { id: string }) => row.id,
      ),
    ).toEqual([hotelId]);
    await hotels.updateOne({ _id: hotelId }, { $set: { active: false } });
    expect(
      (await search({ rooms: 2, guests: 4 }).expect(200)).body.data,
    ).toEqual([]);
  });

  it('preserves price/rating filters and sorting', async () => {
    expect(
      (await search({ order: 'desc' }).expect(200)).body.data.map(
        (row: { name: string }) => row.name,
      ),
    ).toEqual(['Beta', 'Alpha']);
    expect(
      (
        await search({ minPriceMinor: 1500, maxPriceMinor: 2500 }).expect(200)
      ).body.data.map((row: { name: string }) => row.name),
    ).toEqual(['Beta']);
    expect(
      (await search({ minRating: 4 }).expect(200)).body.data.map(
        (row: { name: string }) => row.name,
      ),
    ).toEqual(['Alpha']);
    await search({ minPriceMinor: 2000, maxPriceMinor: 1000 }).expect(400);
  });

  it('paginates actual matching hotels ten per page', async () => {
    for (let index = 0; index < 10; index++)
      await addHotel(`Extra ${index}`, 'cairo', 4000 + index);
    const first = (await search().expect(200)).body;
    const second = (await search({ page: 2 }).expect(200)).body;
    expect(first.meta).toEqual({
      page: 1,
      limit: 10,
      total: 12,
      totalPages: 2,
    });
    expect(first.data).toHaveLength(10);
    expect(second.data).toHaveLength(2);
    expect(
      new Set(
        [...first.data, ...second.data].map((row: { id: string }) => row.id),
      ).size,
    ).toBe(12);
  });

  it('requires traveler ownership even for a public itinerary and rejects foreign days', async () => {
    await request(app.getHttpServer())
      .get(`/api/itineraries/${trip.id}/hotels`)
      .query({ dayId: trip.days[0].id, guests: 1 })
      .expect(401);
    await search({}, staff).expect(403);
    await owner
      .patch(`/api/itineraries/${trip.id}`)
      .send({ visibility: 'public' })
      .expect(200);
    await search({}, other).expect(404);
    await search({ dayId: new Types.ObjectId().toString() }).expect(404);
  });

  it('rejects malformed input and client overrides of the derived city/dates', async () => {
    const invalidQueries: Record<string, string | number>[] = [
      { guests: 0 },
      { guests: 1.5 },
      { rooms: 0 },
      { page: 0 },
      { dayId: 'invalid' },
      { cityId: 'paris' },
      { countryCode: 'FR' },
      { checkIn: day(20) },
      { checkOut: day(25) },
      { sortBy: 'secret' },
    ];
    for (const invalid of invalidQueries) {
      await search(invalid).expect(400);
    }
    await owner
      .get(`/api/itineraries/${trip.id}/hotels`)
      .query({ dayId: trip.days[0].id })
      .expect(400);
    await owner
      .get('/api/itineraries/invalid/hotels')
      .query({ dayId: trip.days[0].id, guests: 1 })
      .expect(400);
  });

  it('rejects past stays and exclusive checkout overflow without changing the itinerary', async () => {
    await owner
      .patch(`/api/itineraries/${trip.id}`)
      .send({ startDate: day(-10) })
      .expect(200);
    await search().expect(400);
    await owner
      .patch(`/api/itineraries/${trip.id}`)
      .send({ startDate: '9999-12-28' })
      .expect(200);
    await search({ dayId: trip.days[3].id }).expect(400);
    expect(
      (await owner.get(`/api/itineraries/${trip.id}`).expect(200)).body
        .startDate,
    ).toBe('9999-12-28');
  });

  it('documents derived selection, pagination, filters and the response in Swagger', async () => {
    const doc = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    const operation = doc.paths['/api/itineraries/{id}/hotels'].get;
    const names = operation.parameters.map(
      (entry: { name: string }) => entry.name,
    );
    expect(names).toEqual(
      expect.arrayContaining([
        'id',
        'dayId',
        'guests',
        'rooms',
        'page',
        'minRating',
      ]),
    );
    expect(names).not.toEqual(
      expect.arrayContaining(['cityId', 'checkIn', 'checkOut']),
    );
    expect(
      operation.responses['200'].content['application/json'].schema.$ref,
    ).toContain('ItineraryHotelsPageDto');
  });
});
