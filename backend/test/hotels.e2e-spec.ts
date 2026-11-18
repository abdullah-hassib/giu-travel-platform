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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { OutboxEvent } from '../src/common/events/outbox-event.schema';
import { hashPassword } from '../src/modules/auth/security/password';
import { HotelBookingsModule } from '../src/modules/hotel-bookings/hotel-bookings.module';
import { HotelPaymentAdapter } from '../src/modules/hotel-bookings/hotel-payment.adapter';
import { HotelBooking } from '../src/modules/hotel-bookings/schemas/hotel-booking.schema';
import { HotelsModule } from '../src/modules/hotels/hotels.module';
import { Hotel } from '../src/modules/hotels/schemas/hotel.schema';
import { HotelRoom } from '../src/modules/hotels/schemas/room.schema';
import { addDays, todayUtc } from '../src/modules/hotels/stay-rules';
import { ReviewsModule } from '../src/modules/reviews/reviews.module';
import { RefundsService } from '../src/modules/refunds/refunds.service';
import { User } from '../src/modules/users/schemas/user.schema';

const uploadDir = mkdtempSync(join(tmpdir(), 'giu-hotel-media-'));

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

const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489',
  'hex',
);
const day = (offset: number) => addDays(todayUtc(), offset);
type Agent = ReturnType<typeof request.agent>;

describe('Hotels, rooms, bookings and reviews (real HTTP and MongoDB)', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let users: Model<User>;
  let hotels: Model<Hotel>;
  let rooms: Model<HotelRoom>;
  let bookings: Model<HotelBooking>;
  let outbox: Model<OutboxEvent>;
  let payments: HotelPaymentAdapter;
  let passwordHash: string;

  let admin: Agent;
  let moderator: Agent;
  let otherModerator: Agent;
  let traveler: Agent;
  let otherTraveler: Agent;
  let hotelId: string;
  let otherHotelId: string;

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), { dbName: 'giu_hotel_tests' }),
        HotelsModule,
        HotelBookingsModule,
        ReviewsModule,
      ],
    })
      .overrideProvider(RefundsService)
      .useValue({ enqueueCancellation: jest.fn(async () => null) })
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
      SwaggerModule.createDocument(app, new DocumentBuilder().build()),
    );
    await app.init();
    connection = app.get(getConnectionToken());
    users = app.get(getModelToken(User.name));
    hotels = app.get(getModelToken(Hotel.name));
    rooms = app.get(getModelToken(HotelRoom.name));
    bookings = app.get(getModelToken(HotelBooking.name));
    outbox = app.get(getModelToken(OutboxEvent.name));
    payments = app.get(HotelPaymentAdapter);
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    passwordHash = await hashPassword('test-password1');
  });

  afterAll(async () => {
    await app?.close();
    await server?.stop();
    rmSync(uploadDir, { recursive: true, force: true });
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
      {
        email: 'mod@example.com',
        fullName: 'Hotel Mod',
        roles: ['hotel_moderator'],
        passwordHash,
      },
      {
        email: 'mod2@example.com',
        fullName: 'Other Mod',
        roles: ['hotel_moderator'],
        passwordHash,
      },
      { email: 'guest@example.com', fullName: 'Guest One', passwordHash },
      { email: 'guest2@example.com', fullName: 'Guest Two', passwordHash },
    ]);
    [admin, moderator, otherModerator, traveler, otherTraveler] =
      await Promise.all(accounts.map((account) => signIn(account.email)));
    hotelId = (
      await admin.post('/api/hotels').send(hotelBody('Nile View')).expect(201)
    ).body.id;
    otherHotelId = (
      await admin.post('/api/hotels').send(hotelBody('Desert Inn')).expect(201)
    ).body.id;
    // Assignments are created by the administration module (ACC-13); seeded directly here.
    await connection.collection('moderator_assignments').insertMany([
      {
        userId: accounts[1]._id,
        providerType: 'hotel',
        providerId: new Types.ObjectId(hotelId),
      },
      {
        userId: accounts[2]._id,
        providerType: 'hotel',
        providerId: new Types.ObjectId(otherHotelId),
      },
    ]);
  });

  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/login')
      .send({ email, password: 'test-password1' })
      .expect(200);
    return agent;
  }

  function hotelBody(name: string) {
    return {
      name,
      address: '1 Corniche',
      cityId: 'cairo',
      countryCode: 'EG',
      starRating: 4,
      amenities: ['Pool'],
    };
  }

  async function addRoom(
    name: string,
    price = 10_000,
    maxOccupancy = 2,
    hotel = hotelId,
    agent = moderator,
  ) {
    const room = await agent
      .post(`/api/hotels/${hotel}/rooms`)
      .send({
        name,
        type: 'Double',
        beds: 1,
        maxOccupancy,
        pricePerNightMinor: price,
      })
      .expect(201);
    await agent
      .post(`/api/hotels/${hotel}/rooms/${room.body.id}/availability`)
      .send({ from: day(0), to: day(60) })
      .expect(201);
    return room.body.id as string;
  }

  function book(
    agent: Agent,
    roomIds: string[],
    checkIn = day(5),
    checkOut = day(8),
  ) {
    return agent.post('/api/hotel-bookings').send({
      hotelId,
      checkIn,
      checkOut,
      rooms: roomIds.map((roomId) => ({ roomId, adults: 1 })),
    });
  }

  async function confirm(bookingId: string) {
    const booking = await bookings.findById(bookingId).lean();
    await connection.transaction(async (session) => {
      await payments.linkPayment(
        booking!.userId.toString(),
        bookingId,
        'pay_1',
        session,
      );
      expect(
        await payments.confirmPayment(
          booking!.userId.toString(),
          bookingId,
          'pay_1',
          session,
        ),
      ).toBe('Confirmed');
    });
  }

  describe('hotel profiles and moderator ownership', () => {
    it('lets only admins create hotels and validates the city against the country', async () => {
      await request(app.getHttpServer())
        .post('/api/hotels')
        .send(hotelBody('X'))
        .expect(401);
      await traveler.post('/api/hotels').send(hotelBody('X')).expect(403);
      await moderator.post('/api/hotels').send(hotelBody('X')).expect(403);
      await admin
        .post('/api/hotels')
        .send({ ...hotelBody('X'), countryCode: 'FR' })
        .expect(400);
      await admin
        .post('/api/hotels')
        .send({ ...hotelBody('X'), starRating: 6 })
        .expect(400);
    });

    it('lets a moderator manage only their assigned hotel', async () => {
      await moderator
        .patch(`/api/hotels/${hotelId}`)
        .send({ description: 'Updated' })
        .expect(200);
      await moderator
        .patch(`/api/hotels/${otherHotelId}`)
        .send({ description: 'Nope' })
        .expect(403);
      await moderator
        .post(`/api/hotels/${otherHotelId}/rooms`)
        .send({
          name: '1',
          type: 'Single',
          beds: 1,
          maxOccupancy: 1,
          pricePerNightMinor: 100,
        })
        .expect(403);
      await moderator
        .put(`/api/hotels/${otherHotelId}/policies`)
        .send({
          checkInTime: '15:00',
          checkOutTime: '11:00',
          cancellationTiers: [],
        })
        .expect(403);
      await moderator
        .get(`/api/hotels/${otherHotelId}/reservations`)
        .expect(403);
      await traveler
        .patch(`/api/hotels/${hotelId}`)
        .send({ description: 'Nope' })
        .expect(403);
      await moderator
        .patch(`/api/hotels/${hotelId}`)
        .send({ description: null })
        .expect(400);
    });

    it('saves policies with unique tier thresholds and shows them on the hotel page', async () => {
      await moderator
        .put(`/api/hotels/${hotelId}/policies`)
        .send({
          checkInTime: '15:00',
          checkOutTime: '11:00',
          cancellationTiers: [
            { daysBefore: 3, refundPercent: 50 },
            { daysBefore: 3, refundPercent: 20 },
          ],
        })
        .expect(400);
      await moderator
        .put(`/api/hotels/${hotelId}/policies`)
        .send({
          checkInTime: '25:00',
          checkOutTime: '11:00',
          cancellationTiers: [],
        })
        .expect(400);
      await moderator
        .put(`/api/hotels/${hotelId}/policies`)
        .send({
          checkInTime: '15:00',
          checkOutTime: '11:00',
          cancellationTiers: [
            { daysBefore: 7, refundPercent: 100 },
            { daysBefore: 2, refundPercent: 50 },
          ],
        })
        .expect(200);
      const page = await request(app.getHttpServer())
        .get(`/api/hotels/${hotelId}`)
        .expect(200);
      expect(page.body).toMatchObject({
        checkInTime: '15:00',
        checkOutTime: '11:00',
        cancellationTiers: [
          { daysBefore: 7, refundPercent: 100 },
          { daysBefore: 2, refundPercent: 50 },
        ],
        averageRating: null,
        ratingCount: 0,
      });
    });
  });

  describe('rooms and availability', () => {
    it('keeps room names unique per hotel and availability ranges non-overlapping', async () => {
      const roomId = await addRoom('101');
      await moderator
        .post(`/api/hotels/${hotelId}/rooms`)
        .send({
          name: '101',
          type: 'Suite',
          beds: 2,
          maxOccupancy: 3,
          pricePerNightMinor: 500,
        })
        .expect(409);
      await moderator
        .post(`/api/hotels/${hotelId}/rooms`)
        .send({
          name: '102',
          type: 'Suite',
          beds: 2,
          maxOccupancy: 0,
          pricePerNightMinor: 0,
        })
        .expect(400);
      await moderator
        .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .send({ from: day(30), to: day(90) })
        .expect(409);
      await moderator
        .post(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .send({ from: day(60), to: day(90) })
        .expect(201);
    });

    it('refuses to block, deactivate or delete a room with a reservation', async () => {
      const roomId = await addRoom('101');
      const freeRoomId = await addRoom('102');
      await book(traveler, [roomId]).expect(201);
      const base = `/api/hotels/${hotelId}/rooms/${roomId}`;
      await moderator
        .patch(`${base}/availability`)
        .send({ blocked: [{ from: day(6), to: day(7) }] })
        .expect(409);
      await moderator
        .patch(`${base}/availability`)
        .send({ availability: [{ from: day(10), to: day(60) }] })
        .expect(409);
      await moderator.patch(base).send({ active: false }).expect(409);
      await moderator.delete(base).expect(409);
      // Blocking other dates, editing price and deleting a never-reserved room are fine.
      await moderator
        .patch(`${base}/availability`)
        .send({ blocked: [{ from: day(20), to: day(22) }] })
        .expect(200);
      await moderator
        .patch(base)
        .send({ pricePerNightMinor: 99_999 })
        .expect(200);
      await moderator
        .delete(`/api/hotels/${hotelId}/rooms/${freeRoomId}`)
        .expect(204);
      // The reservation keeps the price it was booked at (HTL-05).
      expect(
        (await bookings.findOne().lean())!.rooms[0].pricePerNightMinor,
      ).toBe(10_000);
    });

    it('shows each night as Available, Booked, Blocked or Unavailable (HTL-08)', async () => {
      const roomId = await addRoom('101');
      const booking = await book(traveler, [roomId], day(2), day(3)).expect(
        201,
      );
      await moderator
        .patch(`/api/hotels/${hotelId}/rooms/${roomId}/availability`)
        .send({ blocked: [{ from: day(3), to: day(4) }] })
        .expect(200);
      const view = await moderator
        .get(`/api/hotels/${hotelId}/availability`)
        .query({ from: day(1), to: day(5) })
        .expect(200);
      expect(
        view.body.data[0].nights.map(
          (night: { status: string }) => night.status,
        ),
      ).toEqual(['Available', 'Booked', 'Blocked', 'Available']);
      expect(view.body.data[0].nights[1].bookingId).toBe(booking.body.id);
      const far = await moderator
        .get(`/api/hotels/${hotelId}/availability`)
        .query({ from: day(59), to: day(61) })
        .expect(200);
      expect(
        far.body.data[0].nights.map(
          (night: { status: string }) => night.status,
        ),
      ).toEqual(['Available', 'Unavailable']);
      await moderator
        .get(`/api/hotels/${hotelId}/availability`)
        .query({ from: day(1), to: day(40) })
        .expect(400);
    });
  });

  describe('search (HTL-11/HTL-12)', () => {
    beforeEach(async () => {
      await addRoom('cheap', 5_000, 2);
      await addRoom('big', 20_000, 4);
      await addRoom('desert', 8_000, 2, otherHotelId, otherModerator);
    });

    const search = (query: Record<string, unknown>) =>
      request(app.getHttpServer())
        .get('/api/hotels/search')
        .query({
          cityId: 'cairo',
          checkIn: day(5),
          checkOut: day(7),
          guests: 2,
          ...query,
        });

    it('lists hotels with enough free rooms and capacity, cheapest price first', async () => {
      const result = await search({}).expect(200);
      expect(
        result.body.data.map((hotel: { name: string }) => hotel.name),
      ).toEqual(['Nile View', 'Desert Inn']);
      expect(result.body.data[0]).toMatchObject({
        pricePerNightMinor: 5_000,
        freeRooms: 2,
        currency: 'USD',
      });
      expect(result.body.meta).toEqual({
        page: 1,
        limit: 10,
        total: 2,
        totalPages: 1,
      });

      const sixGuests = await search({ guests: 6, rooms: 2 }).expect(200);
      expect(
        sixGuests.body.data.map((hotel: { name: string }) => hotel.name),
      ).toEqual(['Nile View']);
      expect(
        (await search({ guests: 7, rooms: 2 }).expect(200)).body.data,
      ).toEqual([]);
      expect((await search({ rooms: 3 }).expect(200)).body.data).toEqual([]);
    });

    it('filters by price and rating and validates the query', async () => {
      const priced = await search({
        minPriceMinor: 6_000,
        maxPriceMinor: 9_000,
      }).expect(200);
      expect(
        priced.body.data.map((hotel: { name: string }) => hotel.name),
      ).toEqual(['Desert Inn']);
      await hotels.updateOne(
        { _id: otherHotelId },
        { $set: { ratingSum: 9, ratingCount: 2 } },
      );
      const rated = await search({ minRating: 4 }).expect(200);
      expect(
        rated.body.data.map((hotel: { name: string }) => hotel.name),
      ).toEqual(['Desert Inn']);
      const byRating = await search({ sortBy: 'rating' }).expect(200);
      expect(
        byRating.body.data.map((hotel: { name: string }) => hotel.name),
      ).toEqual(['Desert Inn', 'Nile View']);

      await search({ minPriceMinor: 9_000, maxPriceMinor: 1_000 }).expect(400);
      await search({ checkIn: day(-1) }).expect(400);
      await search({ checkOut: day(5) }).expect(400);
      await search({ cityId: undefined }).expect(400);
      await search({ guests: 0 }).expect(400);
    });

    it('hides held rooms and deactivated hotels; an expired hold frees the room again', async () => {
      const big = (await rooms.findOne({ name: 'big' }).lean())!._id.toString();
      const hold = await book(traveler, [big]).expect(201);
      expect((await search({ guests: 4 }).expect(200)).body.data).toEqual([]);

      await bookings.updateOne(
        { _id: hold.body.id },
        { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
      );
      expect((await search({ guests: 4 }).expect(200)).body.data).toHaveLength(
        1,
      );
      const mine = await traveler
        .get('/api/hotel-bookings')
        .query({ group: 'past' })
        .expect(200);
      expect(mine.body.data[0].status).toBe('Expired');

      await moderator
        .patch(`/api/hotels/${hotelId}/status`)
        .send({ active: false })
        .expect(403);
      await admin
        .patch(`/api/hotels/${hotelId}/status`)
        .send({ active: false })
        .expect(200);
      expect(
        (await search({}).expect(200)).body.data.map(
          (hotel: { name: string }) => hotel.name,
        ),
      ).toEqual(['Desert Inn']);
      await request(app.getHttpServer())
        .get(`/api/hotels/${hotelId}`)
        .expect(404);
      await book(traveler, [big]).expect(404);
      expect(await outbox.countDocuments({ type: 'hotel.deactivated' })).toBe(
        1,
      );
    });
  });

  describe('booking holds (HTL-16/HTL-18)', () => {
    it('holds several rooms as one Pending Payment reservation for 10 minutes', async () => {
      const a = await addRoom('101', 10_000);
      const b = await addRoom('102', 15_000);
      const before = Date.now();
      const result = await traveler
        .post('/api/hotel-bookings')
        .send({
          hotelId,
          checkIn: day(5),
          checkOut: day(8),
          rooms: [
            { roomId: a, adults: 2 },
            { roomId: b, adults: 0, childrenAges: [4, 17] },
          ],
        })
        .expect(201);
      expect(result.body).toMatchObject({
        status: 'Pending Payment',
        nights: 3,
        totalMinor: 75_000,
        currency: 'USD',
        guests: { adults: 2, children: 2 },
        reference: null,
      });
      const holdMs = Date.parse(result.body.holdExpiresAt) - before;
      expect(holdMs).toBeGreaterThan(9 * 60_000);
      expect(holdMs).toBeLessThanOrEqual(10 * 60_000 + 5_000);
    });

    it('validates guests, dates and room selection', async () => {
      const a = await addRoom('101');
      const send = (body: Record<string, unknown>) =>
        traveler.post('/api/hotel-bookings').send({
          hotelId,
          checkIn: day(5),
          checkOut: day(8),
          rooms: [{ roomId: a, adults: 1 }],
          ...body,
        });
      await send({
        rooms: [{ roomId: a, adults: 0, childrenAges: [5] }],
      }).expect(400);
      await send({
        rooms: [{ roomId: a, adults: 2, childrenAges: [5] }],
      }).expect(400);
      await send({
        rooms: [{ roomId: a, adults: 1, childrenAges: [18] }],
      }).expect(400);
      await send({
        rooms: [
          { roomId: a, adults: 1 },
          { roomId: a, adults: 1 },
        ],
      }).expect(400);
      await send({ checkIn: day(-1) }).expect(400);
      await send({ checkOut: day(5) }).expect(400);
      await send({ checkIn: day(58), checkOut: day(62) }).expect(409);
      await send({ rooms: [] }).expect(400);
      await moderator
        .post('/api/hotel-bookings')
        .send({
          hotelId,
          checkIn: day(5),
          checkOut: day(8),
          rooms: [{ roomId: a, adults: 1 }],
        })
        .expect(403);
      expect(await bookings.countDocuments()).toBe(0);
    });

    it('lets exactly one of several simultaneous requests reserve the same room', async () => {
      const a = await addRoom('101');
      const attempts = await Promise.all([
        book(traveler, [a]),
        book(otherTraveler, [a]),
        book(traveler, [a], day(6), day(8)),
        book(otherTraveler, [a], day(7), day(9)),
      ]);
      expect(attempts.map((response) => response.status).sort()).toEqual([
        201, 409, 409, 409,
      ]);
      expect(await bookings.countDocuments()).toBe(1);
    });

    it('never partially holds a multi-room reservation', async () => {
      const a = await addRoom('101');
      const b = await addRoom('102');
      await moderator
        .patch(`/api/hotels/${hotelId}/rooms/${b}/availability`)
        .send({ blocked: [{ from: day(7), to: day(8) }] })
        .expect(200);
      await book(traveler, [a, b]).expect(409);
      await book(otherTraveler, [b], day(6), day(7)).expect(201);
      await book(traveler, [a, b], day(6), day(7)).expect(409);
      expect(await bookings.countDocuments()).toBe(1);
      // Room a was never held by the failed requests.
      await book(traveler, [a]).expect(201);
    });

    it('allows back-to-back stays and keeps cancelled stays from blocking', async () => {
      const a = await addRoom('101');
      await book(traveler, [a], day(5), day(8)).expect(201);
      await book(otherTraveler, [a], day(8), day(10)).expect(201);
      await book(otherTraveler, [a], day(3), day(5)).expect(201);
    });
  });

  describe('booking privacy, payment confirmation and cancellation', () => {
    let roomId: string;
    let bookingId: string;

    beforeEach(async () => {
      roomId = await addRoom('101', 10_000);
      await moderator
        .put(`/api/hotels/${hotelId}/policies`)
        .send({
          checkInTime: '14:00',
          checkOutTime: '12:00',
          cancellationTiers: [
            { daysBefore: 3, refundPercent: 50 },
            { daysBefore: 10, refundPercent: 100 },
          ],
        })
        .expect(200);
      bookingId = (await book(traveler, [roomId], day(5), day(8)).expect(201))
        .body.id;
    });

    it('shows a booking only to its owner, admins and the hotel moderator (ACC-11)', async () => {
      await traveler.get(`/api/hotel-bookings/${bookingId}`).expect(200);
      await otherTraveler.get(`/api/hotel-bookings/${bookingId}`).expect(404);
      await otherModerator.get(`/api/hotel-bookings/${bookingId}`).expect(404);
      await moderator.get(`/api/hotel-bookings/${bookingId}`).expect(200);
      await admin.get(`/api/hotel-bookings/${bookingId}`).expect(200);
      expect(
        (await otherTraveler.get('/api/hotel-bookings').expect(200)).body.data,
      ).toEqual([]);
      const reservations = await moderator
        .get(`/api/hotels/${hotelId}/reservations`)
        .expect(200);
      expect(reservations.body.data[0]).toMatchObject({
        guestName: 'Guest One',
        status: 'Pending Payment',
      });
    });

    it('confirms only through verified payment, with a unique reference and an event', async () => {
      await traveler
        .post(`/api/hotel-bookings/${bookingId}/cancel`)
        .expect(409);
      await confirm(bookingId);
      const confirmed = await traveler
        .get(`/api/hotel-bookings/${bookingId}`)
        .expect(200);
      expect(confirmed.body.status).toBe('Confirmed');
      expect(confirmed.body.reference).toMatch(/^HTL-[0-9A-F]{8}$/);
      expect(
        await outbox.countDocuments({
          type: 'hotel_booking.confirmed',
          'payload.bookingId': bookingId,
        }),
      ).toBe(1);

      // A repeated confirmation (e.g. webhook redelivery) changes nothing.
      const userId = (await bookings
        .findById(bookingId)
        .lean())!.userId.toString();
      const again = await connection.transaction((session) =>
        payments.confirmPayment(userId, bookingId, 'pay_1', session),
      );
      expect(again).toBe('Confirmed');
      expect(
        await outbox.countDocuments({ type: 'hotel_booking.confirmed' }),
      ).toBe(1);
    });

    it('expires a hold whose payment arrives too late', async () => {
      const userId = (await bookings
        .findById(bookingId)
        .lean())!.userId.toString();
      await connection.transaction((session) =>
        payments.linkPayment(userId, bookingId, 'pay_1', session),
      );
      await bookings.updateOne(
        { _id: bookingId },
        { $set: { holdExpiresAt: new Date(Date.now() - 1000) } },
      );
      const result = await connection.transaction((session) =>
        payments.confirmPayment(userId, bookingId, 'pay_1', session),
      );
      expect(result).toBe('Expired');
      expect((await bookings.findById(bookingId).lean())!.status).toBe(
        'Expired',
      );
      await expect(
        connection.transaction((session) =>
          payments.linkPayment(userId, bookingId, 'pay_2', session),
        ),
      ).rejects.toThrow('can no longer be paid');
    });

    it('cancels a whole Confirmed reservation before check-in with the tier refund', async () => {
      await confirm(bookingId);
      const preview = await traveler
        .get(`/api/hotel-bookings/${bookingId}`)
        .expect(200);
      expect(preview.body.cancellation).toMatchObject({
        cancellable: true,
        refundPercent: 50,
        refundMinor: 15_000,
      });

      await otherTraveler
        .post(`/api/hotel-bookings/${bookingId}/cancel`)
        .expect(404);
      const cancelled = await traveler
        .post(`/api/hotel-bookings/${bookingId}/cancel`)
        .expect(200);
      expect(cancelled.body).toMatchObject({
        status: 'Cancelled',
        cancellation: { refundPercent: 50, refundMinor: 15_000 },
      });
      await traveler
        .post(`/api/hotel-bookings/${bookingId}/cancel`)
        .expect(409);
      expect(
        await outbox.countDocuments({
          type: 'hotel_booking.cancelled',
          'payload.refundMinor': 15_000,
        }),
      ).toBe(1);
      expect(
        (
          await traveler
            .get('/api/hotel-bookings')
            .query({ group: 'cancelled' })
            .expect(200)
        ).body.meta.total,
      ).toBe(1);

      // The room is free again for those dates.
      await book(otherTraveler, [roomId], day(5), day(8)).expect(201);
    });

    it('refuses to cancel on or after the check-in date', async () => {
      await confirm(bookingId);
      await bookings.updateOne(
        { _id: bookingId },
        { $set: { checkIn: todayUtc() } },
      );
      await traveler
        .post(`/api/hotel-bookings/${bookingId}/cancel`)
        .expect(409);
    });
  });

  describe('reviews (HTL-23/HTL-24)', () => {
    let bookingId: string;

    beforeEach(async () => {
      const roomId = await addRoom('101');
      bookingId = (await book(traveler, [roomId], day(5), day(8)).expect(201))
        .body.id;
      await confirm(bookingId);
    });

    async function completeStay() {
      await bookings.updateOne(
        { _id: bookingId },
        { $set: { checkIn: day(-4), checkOut: day(-1) } },
      );
    }

    it('accepts one review per completed stay and keeps the hotel average current', async () => {
      await traveler
        .post(`/api/hotel-bookings/${bookingId}/review`)
        .send({ rating: 5 })
        .expect(409);
      await completeStay();
      await otherTraveler
        .post(`/api/hotel-bookings/${bookingId}/review`)
        .send({ rating: 1 })
        .expect(404);
      await traveler
        .post(`/api/hotel-bookings/${bookingId}/review`)
        .send({ rating: 6 })
        .expect(400);
      await traveler
        .post(`/api/hotel-bookings/${bookingId}/review`)
        .send({ rating: 4, comment: 'x'.repeat(1001) })
        .expect(400);
      const review = await traveler
        .post(`/api/hotel-bookings/${bookingId}/review`)
        .send({ rating: 4, comment: 'Lovely' })
        .expect(201);
      await traveler
        .post(`/api/hotel-bookings/${bookingId}/review`)
        .send({ rating: 3 })
        .expect(409);
      expect(
        (await traveler.get(`/api/hotel-bookings/${bookingId}`).expect(200))
          .body.status,
      ).toBe('Completed');

      let listing = await request(app.getHttpServer())
        .get(`/api/hotels/${hotelId}/reviews`)
        .expect(200);
      expect(listing.body).toMatchObject({
        averageRating: 4,
        ratingCount: 1,
        meta: { total: 1 },
      });
      expect(listing.body.data[0]).toMatchObject({
        rating: 4,
        comment: 'Lovely',
        authorName: 'Guest One',
      });

      await otherTraveler
        .patch(`/api/reviews/${review.body.id}`)
        .send({ rating: 1 })
        .expect(404);
      await traveler
        .patch(`/api/reviews/${review.body.id}`)
        .send({ rating: 2 })
        .expect(200);
      listing = await request(app.getHttpServer())
        .get(`/api/hotels/${hotelId}/reviews`)
        .expect(200);
      expect(listing.body).toMatchObject({ averageRating: 2, ratingCount: 1 });

      await users.updateOne(
        { email: 'guest@example.com' },
        { $set: { status: 'deactivated' } },
      );
      listing = await request(app.getHttpServer())
        .get(`/api/hotels/${hotelId}/reviews`)
        .expect(200);
      expect(listing.body.data[0].authorName).toBe('Deleted user');
      await users.updateOne(
        { email: 'guest@example.com' },
        { $set: { status: 'active' } },
      );

      await otherTraveler.delete(`/api/reviews/${review.body.id}`).expect(404);
      await traveler.delete(`/api/reviews/${review.body.id}`).expect(204);
      listing = await request(app.getHttpServer())
        .get(`/api/hotels/${hotelId}/reviews`)
        .expect(200);
      expect(listing.body).toMatchObject({
        averageRating: null,
        ratingCount: 0,
        data: [],
      });
    });

    it('refuses reviews for cancelled stays', async () => {
      await traveler
        .post(`/api/hotel-bookings/${bookingId}/cancel`)
        .expect(200);
      await completeStay();
      await traveler
        .post(`/api/hotel-bookings/${bookingId}/review`)
        .send({ rating: 5 })
        .expect(409);
    });
  });

  describe('hotel photos (GEN-08)', () => {
    it('accepts real JPG/PNG images up to five per hotel and serves them', async () => {
      await moderator
        .post(`/api/hotels/${hotelId}/images`)
        .attach('file', Buffer.from('not really an image'), {
          filename: 'fake.png',
          contentType: 'image/png',
        })
        .expect(400);
      await moderator.post(`/api/hotels/${hotelId}/images`).expect(400);
      await otherModerator
        .post(`/api/hotels/${hotelId}/images`)
        .attach('file', PNG, 'a.png')
        .expect(403);
      await moderator
        .post(`/api/hotels/${hotelId}/images`)
        .attach('file', Buffer.alloc(5 * 1024 * 1024 + 1, 0xff), 'huge.jpg')
        .expect(413);

      let hotel;
      for (let i = 0; i < 5; i++) {
        hotel = await moderator
          .post(`/api/hotels/${hotelId}/images`)
          .attach('file', PNG, `p${i}.png`)
          .expect(201);
      }
      await moderator
        .post(`/api/hotels/${hotelId}/images`)
        .attach('file', PNG, 'p6.png')
        .expect(400);
      const image = hotel!.body.images[0];
      const served = await request(app.getHttpServer())
        .get(image.url)
        .expect(200);
      expect(served.headers['content-type']).toBe('image/png');
      await moderator
        .delete(`/api/hotels/${hotelId}/images/${image.id}`)
        .expect(200);
      await request(app.getHttpServer()).get(image.url).expect(404);
    });
  });

  it('documents the hotel, booking and review routes in Swagger', async () => {
    const document = await request(app.getHttpServer())
      .get('/api/docs-json')
      .expect(200);
    for (const path of [
      '/api/hotels',
      '/api/hotels/search',
      '/api/hotels/{id}',
      '/api/hotels/{id}/rooms',
      '/api/hotels/{id}/rooms/available',
      '/api/hotels/{id}/availability',
      '/api/hotels/{id}/policies',
      '/api/hotels/{id}/reservations',
      '/api/hotel-bookings',
      '/api/hotel-bookings/{id}',
      '/api/hotel-bookings/{id}/cancel',
      '/api/hotel-bookings/{id}/review',
      '/api/reviews/{id}',
      '/api/hotels/{id}/reviews',
    ]) {
      expect(document.body.paths[path]).toBeDefined();
    }
  });
});
