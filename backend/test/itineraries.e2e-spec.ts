import {
  Global,
  INestApplication,
  Module,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Model, Types } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import request from 'supertest';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { User } from '../src/modules/users/schemas/user.schema';
import { UserSession } from '../src/modules/auth/schemas/user-session.schema';
import { hashPassword } from '../src/modules/auth/security/password';
import { ItinerariesModule } from '../src/modules/itineraries/itineraries.module';
import { ItinerariesService } from '../src/modules/itineraries/itineraries.service';
import { Itinerary } from '../src/modules/itineraries/schemas/itinerary.schema';

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

describe('Itinerary core (real feature modules, HTTP and MongoDB)', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryServer;
  let app: INestApplication;
  let users: Model<User>;
  let sessions: Model<UserSession>;
  let itineraries: Model<Itinerary>;
  let ownerId: string;
  let otherId: string;
  let passwordHash: string;
  const base = {
    title: 'Test journey',
    countryCodes: ['EG', 'FR', 'GB'],
    startDate: '2028-02-28',
  };

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), {
          dbName: 'giu_itinerary_tests',
        }),
        ItinerariesModule,
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
        new DocumentBuilder().setTitle('Test API').build(),
      ),
    );
    await app.init();
    users = app.get(getModelToken(User.name));
    sessions = app.get(getModelToken(UserSession.name));
    itineraries = app.get(getModelToken(Itinerary.name));
    await Promise.all([users.init(), sessions.init(), itineraries.init()]);
    passwordHash = await hashPassword('test-password1');
  });

  beforeEach(async () => {
    await Promise.all([
      users.deleteMany({}),
      sessions.deleteMany({}),
      itineraries.deleteMany({}),
    ]);
    const owner = await users.create({
      email: 'owner@example.com',
      fullName: 'Original Author',
      passwordHash,
    });
    const other = await users.create({
      email: 'other@example.com',
      fullName: 'Another Traveler',
      passwordHash,
    });
    ownerId = owner._id.toString();
    otherId = other._id.toString();
  });
  afterEach(() => jest.restoreAllMocks());
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

  async function create(agent: Awaited<ReturnType<typeof signIn>>) {
    return (await agent.post('/api/itineraries').send(base).expect(201)).body;
  }

  it('creates private itineraries and lists only the owner records, ten per page', async () => {
    const owner = await signIn();
    const created = await owner
      .post('/api/itineraries')
      .send({ ...base, title: '  Journey  ' })
      .expect(201);
    expect(created.body).toMatchObject({
      ownerId,
      title: 'Journey',
      visibility: 'private',
      days: [],
      cityGroups: [],
    });
    await itineraries.insertMany(
      Array.from({ length: 11 }, (_, index) => ({
        ...base,
        title: `Journey ${index}`,
        ownerId,
      })),
    );
    await itineraries.create({ ...base, ownerId: otherId });
    const first = await owner.get('/api/itineraries').expect(200);
    const second = await owner.get('/api/itineraries?page=2').expect(200);
    expect(first.body.meta).toEqual({
      page: 1,
      limit: 10,
      total: 12,
      totalPages: 2,
    });
    expect(first.body.data).toHaveLength(10);
    expect(second.body.data).toHaveLength(2);
    expect(
      first.body.data.every(
        (row: { ownerId: string }) => row.ownerId === ownerId,
      ),
    ).toBe(true);
    expect(first.headers['cache-control']).toBe('no-store');
  });

  it('enforces owner access for parent, day and activity changes', async () => {
    const owner = await signIn();
    const other = await signIn('other@example.com');
    const trip = await create(owner);
    const day = (
      await owner
        .post(`/api/itineraries/${trip.id}/days`)
        .send({ cityId: 'cairo' })
        .expect(201)
    ).body.days[0];
    const activity = (
      await owner
        .post(`/api/itineraries/${trip.id}/days/${day.id}/activities`)
        .send({ name: 'Museum' })
        .expect(201)
    ).body.days[0].activities[0];
    await other.get(`/api/itineraries/${trip.id}`).expect(404);
    await other
      .patch(`/api/itineraries/${trip.id}`)
      .send({ title: 'Stolen' })
      .expect(404);
    await other.delete(`/api/itineraries/${trip.id}`).expect(404);
    await other
      .post(`/api/itineraries/${trip.id}/days`)
      .send({ cityId: 'paris' })
      .expect(404);
    await other
      .patch(`/api/itineraries/${trip.id}/days/${day.id}`)
      .send({ cityId: 'paris' })
      .expect(404);
    await other
      .delete(`/api/itineraries/${trip.id}/days/${day.id}`)
      .expect(404);
    await other
      .patch(`/api/activities/${activity.id}`)
      .send({ name: 'Stolen' })
      .expect(404);
    await other.delete(`/api/activities/${activity.id}`).expect(404);
    await request(app.getHttpServer())
      .get(`/api/itineraries/${trip.id}`)
      .expect(401);
  });

  it.each(['admin', 'airline_moderator', 'hotel_moderator'])(
    'restricts itinerary authoring for the %s-only role',
    async (role) => {
      await users.create({
        email: 'staff@example.com',
        fullName: 'Staff',
        passwordHash,
        roles: [role],
      });
      const staff = await signIn('staff@example.com');
      await staff.post('/api/itineraries').send(base).expect(403);
    },
  );

  it('enforces forced-password-change sessions on itinerary routes', async () => {
    await users.updateOne(
      { _id: ownerId },
      { $set: { mustChangePassword: true } },
    );
    const owner = await signIn();
    await owner.post('/api/itineraries').send(base).expect(403);
    await owner.get('/api/itineraries').expect(403);
  });

  it.each([
    { title: '   ' },
    { title: 'A'.repeat(101) },
    { title: null },
    { countryCodes: [] },
    { countryCodes: ['ZZ'] },
    { countryCodes: ['EG', 'EG'] },
    { startDate: '2026-02-30' },
    { startDate: '2026-11-20T00:00:00Z' },
    { ownerId: '000000000000000000000000' },
    { visibility: 'public' },
  ])('rejects invalid or injected creation fields %p', async (fields) => {
    const owner = await signIn();
    await owner
      .post('/api/itineraries')
      .send({ ...base, ...fields })
      .expect(400);
    expect(await itineraries.countDocuments()).toBe(0);
  });

  it('keeps leap/year boundaries, reordering, city groups and activity subtotals consistent', async () => {
    const owner = await signIn();
    const trip = await create(owner);
    for (const cityId of ['cairo', 'cairo', 'paris', 'cairo'])
      await owner
        .post(`/api/itineraries/${trip.id}/days`)
        .send({ cityId })
        .expect(201);
    const initial = (await owner.get(`/api/itineraries/${trip.id}`).expect(200))
      .body;
    expect(initial.days.map((day: { date: string }) => day.date)).toEqual([
      '2028-02-28',
      '2028-02-29',
      '2028-03-01',
      '2028-03-02',
    ]);
    for (let index = 0; index < 4; index++) {
      await owner
        .post(
          `/api/itineraries/${trip.id}/days/${initial.days[index].id}/activities`,
        )
        .send({
          name: `Activity ${index}`,
          time: '14:30',
          cost: {
            amountMinor: (index + 1) * 100,
            currency: index === 2 ? 'EUR' : 'USD',
          },
        })
        .expect(201);
    }
    const original = (
      await owner.get(`/api/itineraries/${trip.id}`).expect(200)
    ).body;
    expect(
      original.cityGroups.map((group: { dayCount: number }) => group.dayCount),
    ).toEqual([2, 1, 1]);
    expect(original.cityGroups[0].activityTotals).toEqual({ USD: 300 });
    await owner
      .patch(`/api/itineraries/${trip.id}`)
      .send({ startDate: '2026-12-31' })
      .expect(200);
    const ids = [
      initial.days[3].id,
      initial.days[0].id,
      initial.days[1].id,
      initial.days[2].id,
    ];
    const reordered = (
      await owner
        .patch(`/api/itineraries/${trip.id}/days/reorder`)
        .send({ dayIds: ids })
        .expect(200)
    ).body;
    expect(reordered.days.map((day: { date: string }) => day.date)).toEqual([
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
    expect(
      reordered.cityGroups.map((group: { dayCount: number }) => group.dayCount),
    ).toEqual([3, 1]);
    expect(reordered.cityGroups[0].activityTotals).toEqual({ USD: 700 });
    const removed = (
      await owner
        .delete(`/api/itineraries/${trip.id}/days/${initial.days[0].id}`)
        .expect(200)
    ).body;
    expect(
      removed.days.map((day: { dayNumber: number }) => day.dayNumber),
    ).toEqual([1, 2, 3]);
    expect(removed.cityGroups[0].activityTotals).toEqual({ USD: 600 });
    expect(removed.days[2].date).toBe('2027-01-02');
  });

  it('rejects cities outside selected countries and conflicting country edits', async () => {
    const owner = await signIn();
    const trip = (
      await owner
        .post('/api/itineraries')
        .send({ ...base, countryCodes: ['EG'] })
        .expect(201)
    ).body;
    await owner
      .post(`/api/itineraries/${trip.id}/days`)
      .send({ cityId: 'paris' })
      .expect(400);
    await owner
      .post(`/api/itineraries/${trip.id}/days`)
      .send({ cityId: 'unknown' })
      .expect(400);
    await owner
      .post(`/api/itineraries/${trip.id}/days`)
      .send({ cityId: 'cairo' })
      .expect(201);
    await owner
      .patch(`/api/itineraries/${trip.id}`)
      .send({ countryCodes: ['FR'], title: 'Invalid change' })
      .expect(400);
    await owner
      .patch(`/api/itineraries/${trip.id}`)
      .send({ title: null })
      .expect(400);
    expect(
      (await owner.get(`/api/itineraries/${trip.id}`).expect(200)).body.title,
    ).toBe(base.title);
  });

  it('rejects incomplete/duplicate/foreign reorder IDs', async () => {
    const owner = await signIn();
    const trip = await create(owner);
    const added = (
      await owner
        .post(`/api/itineraries/${trip.id}/days`)
        .send({ cityId: 'cairo' })
        .expect(201)
    ).body;
    await owner
      .patch(`/api/itineraries/${trip.id}/days/reorder`)
      .send({ dayIds: [] })
      .expect(400);
    await owner
      .patch(`/api/itineraries/${trip.id}/days/reorder`)
      .send({ dayIds: [added.days[0].id, added.days[0].id] })
      .expect(400);
    await owner
      .patch(`/api/itineraries/${trip.id}/days/reorder`)
      .send({ dayIds: [new Types.ObjectId().toString()] })
      .expect(404);
  });

  it('enforces the sixty-day limit under concurrent HTTP appends', async () => {
    const owner = await signIn();
    const trip = await itineraries.create({
      ...base,
      ownerId,
      days: Array.from({ length: 59 }, () => ({
        cityId: 'cairo',
        activities: [],
      })),
    });
    const responses = await Promise.all([
      owner.post(`/api/itineraries/${trip._id}/days`).send({ cityId: 'cairo' }),
      owner.post(`/api/itineraries/${trip._id}/days`).send({ cityId: 'cairo' }),
    ]);
    expect(
      responses.filter((response) => response.status === 201),
    ).toHaveLength(1);
    expect(
      responses.filter((response) => [400, 409].includes(response.status)),
    ).toHaveLength(1);
    expect((await itineraries.findById(trip._id).orFail()).days).toHaveLength(
      60,
    );
    await owner
      .post(`/api/itineraries/${trip._id}/days`)
      .send({ cityId: 'cairo' })
      .expect(400);
  });

  it('returns a conflict rather than overwriting two concurrently loaded versions', async () => {
    const owner = await signIn();
    const trip = await create(owner);
    const first = await itineraries.findById(trip.id).orFail();
    const second = await itineraries.findById(trip.id).orFail();
    jest
      .spyOn(itineraries, 'findOne')
      .mockReturnValueOnce({ exec: async () => first } as never)
      .mockReturnValueOnce({ exec: async () => second } as never);
    const service = app.get(ItinerariesService);
    const results = await Promise.allSettled([
      service.addDay(ownerId, trip.id, { cityId: 'cairo' }),
      service.addDay(ownerId, trip.id, { cityId: 'paris' }),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected');
    expect(rejection?.status === 'rejected' && rejection.reason.status).toBe(
      409,
    );
    expect((await itineraries.findById(trip.id).orFail()).days).toHaveLength(1);
  });

  it('edits and clears optional activity fields and deletes activity costs', async () => {
    const owner = await signIn();
    const trip = await create(owner);
    const day = (
      await owner
        .post(`/api/itineraries/${trip.id}/days`)
        .send({ cityId: 'cairo' })
        .expect(201)
    ).body.days[0];
    const added = (
      await owner
        .post(`/api/itineraries/${trip.id}/days/${day.id}/activities`)
        .send({
          name: ' Museum ',
          time: '12:00',
          cost: { amountMinor: 100, currency: 'EGP' },
        })
        .expect(201)
    ).body;
    const id = added.days[0].activities[0].id;
    const cleared = (
      await owner
        .patch(`/api/activities/${id}`)
        .send({ name: ' Edited ', description: null, time: null, cost: null })
        .expect(200)
    ).body;
    expect(cleared.days[0].activities[0]).toEqual({
      id,
      name: 'Edited',
      description: '',
    });
    expect(cleared.cityGroups[0].activityTotals).toEqual({});
    const deleted = (await owner.delete(`/api/activities/${id}`).expect(200))
      .body;
    expect(deleted.days[0].activities).toEqual([]);
  });

  it.each([
    { name: ' ' },
    { time: '24:00' },
    { cost: { amountMinor: -1, currency: 'EGP' } },
    { cost: { amountMinor: 1.5, currency: 'EGP' } },
    { cost: { amountMinor: 1, currency: 'ZZZ' } },
    { cost: [{ amountMinor: 1, currency: 'EGP' }] },
    { cost: { amountMinor: 1, currency: 'EGP', injected: true } },
  ])('validates activity fields and nested cost %p', async (fields) => {
    const owner = await signIn();
    const trip = await create(owner);
    const day = (
      await owner
        .post(`/api/itineraries/${trip.id}/days`)
        .send({ cityId: 'cairo' })
        .expect(201)
    ).body.days[0];
    await owner
      .post(`/api/itineraries/${trip.id}/days/${day.id}/activities`)
      .send({ name: 'Activity', ...fields })
      .expect(400);
  });

  it('publishes, discovers and immediately hides an itinerary without exposing private owners', async () => {
    const owner = await signIn();
    const trip = await create(owner);
    await owner
      .post(`/api/itineraries/${trip.id}/days`)
      .send({ cityId: 'cairo' })
      .expect(201);
    await request(app.getHttpServer())
      .get(`/api/itineraries/public/${trip.id}`)
      .expect(404);
    await owner
      .patch(`/api/itineraries/${trip.id}`)
      .send({ visibility: 'public' })
      .expect(200);
    const found = await request(app.getHttpServer())
      .get('/api/itineraries/public/search')
      .query({
        search: 'CAIRO',
        countryCode: 'EG',
        cityId: 'cairo',
        minDays: 1,
        maxDays: 1,
      })
      .expect(200);
    expect(found.body.meta.total).toBe(1);
    expect(found.body.data[0].author).toEqual({
      id: ownerId,
      name: 'Original Author',
    });
    expect(JSON.stringify(found.body)).not.toContain('owner@example.com');
    expect(JSON.stringify(found.body)).not.toContain('passwordHash');
    await owner
      .patch(`/api/itineraries/${trip.id}`)
      .send({ visibility: 'private' })
      .expect(200);
    await request(app.getHttpServer())
      .get(`/api/itineraries/public/${trip.id}`)
      .expect(404);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/itineraries/public/search')
          .expect(200)
      ).body.meta.total,
    ).toBe(0);
  });

  it('clones public content privately with fresh IDs and attribution, independently of the source', async () => {
    const owner = await signIn();
    const other = await signIn('other@example.com');
    const trip = await create(owner);
    const day = (
      await owner
        .post(`/api/itineraries/${trip.id}/days`)
        .send({ cityId: 'cairo', notes: 'Original notes' })
        .expect(201)
    ).body.days[0];
    const source = (
      await owner
        .post(`/api/itineraries/${trip.id}/days/${day.id}/activities`)
        .send({ name: 'Museum', cost: { amountMinor: 100, currency: 'EGP' } })
        .expect(201)
    ).body;
    await other.post(`/api/itineraries/${trip.id}/clone`).expect(404);
    await owner
      .patch(`/api/itineraries/${trip.id}`)
      .send({ visibility: 'public' })
      .expect(200);
    const clone = (
      await other.post(`/api/itineraries/${trip.id}/clone`).expect(201)
    ).body;
    expect(clone.ownerId).toBe(otherId);
    expect(clone.visibility).toBe('private');
    expect(clone.clonedFrom).toEqual({
      itineraryId: trip.id,
      authorId: ownerId,
      authorName: 'Original Author',
    });
    expect(clone.days[0].id).not.toBe(day.id);
    expect(clone.days[0].activities[0].id).not.toBe(
      source.days[0].activities[0].id,
    );
    expect(clone.days[0].activities[0].cost).toEqual({
      amountMinor: 100,
      currency: 'EGP',
    });
    await other
      .patch(`/api/itineraries/${clone.id}/days/${clone.days[0].id}`)
      .send({ notes: 'Independent notes' })
      .expect(200);
    expect(
      (await owner.get(`/api/itineraries/${trip.id}`).expect(200)).body.days[0]
        .notes,
    ).toBe('Original notes');
    await owner.delete(`/api/itineraries/${trip.id}`).expect(204);
    expect(
      (await other.get(`/api/itineraries/${clone.id}`).expect(200)).body.days[0]
        .notes,
    ).toBe('Independent notes');
    await request(app.getHttpServer())
      .get(`/api/itineraries/public/${trip.id}`)
      .expect(404);
  });

  it('hides public data for deactivated authors and preserves suspended-author content', async () => {
    const owner = await signIn();
    const trip = await create(owner);
    await owner
      .patch(`/api/itineraries/${trip.id}`)
      .send({ visibility: 'public' })
      .expect(200);
    await users.updateOne({ _id: ownerId }, { $set: { status: 'suspended' } });
    await request(app.getHttpServer())
      .get(`/api/itineraries/public/${trip.id}`)
      .expect(200);
    await users.updateOne(
      { _id: ownerId },
      { $set: { status: 'deactivated' } },
    );
    await request(app.getHttpServer())
      .get(`/api/itineraries/public/${trip.id}`)
      .expect(404);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/itineraries/public/search')
          .expect(200)
      ).body.meta.total,
    ).toBe(0);
    const other = await signIn('other@example.com');
    await other.post(`/api/itineraries/${trip.id}/clone`).expect(404);
  });

  it.each([
    'page=0',
    'page=1.5',
    'minDays=5&maxDays=1',
    'minDays=61',
    'cityId=unknown',
    'countryCode=ZZ',
    'search[$ne]=x',
    'limit=100',
  ])('validates public query %s', async (query) => {
    await request(app.getHttpServer())
      .get(`/api/itineraries/public/search?${query}`)
      .expect(400);
  });

  it('documents the endpoints, validation and public/private security in Swagger', async () => {
    const schema = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    expect(schema.paths['/api/itineraries'].post.security).toEqual([
      { giu_session: [] },
    ]);
    expect(
      schema.paths['/api/itineraries/public/search'].get.security ?? [],
    ).toEqual([]);
    expect(
      schema.paths['/api/activities/{id}'].patch.responses['200'].content[
        'application/json'
      ].schema.$ref,
    ).toContain('ItineraryViewDto');
    expect(
      schema.components.schemas.CreateItineraryDto.properties.countryCodes.items
        .enum,
    ).toContain('EG');
  });

  it('normalizes ObjectId case without accepting a duplicate-day permutation', async () => {
    const owner = await signIn();
    const dayId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const activityId = 'bbbbbbbbbbbbbbbbbbbbbbbb';
    const otherDayId = 'cccccccccccccccccccccccc';
    const trip = await itineraries.create({
      ...base,
      ownerId,
      days: [
        {
          _id: new Types.ObjectId(dayId),
          cityId: 'cairo',
          activities: [
            { _id: new Types.ObjectId(activityId), name: 'Activity' },
          ],
        },
        { _id: new Types.ObjectId(otherDayId), cityId: 'paris' },
      ],
    });
    await owner
      .patch(`/api/itineraries/${trip._id}/days/${dayId.toUpperCase()}`)
      .send({ notes: 'Updated' })
      .expect(200);
    await owner
      .patch(`/api/activities/${activityId.toUpperCase()}`)
      .send({ name: 'Updated' })
      .expect(200);
    await owner
      .patch(`/api/itineraries/${trip._id}/days/reorder`)
      .send({ dayIds: [dayId, dayId.toUpperCase()] })
      .expect(400);
    const reordered = (
      await owner
        .patch(`/api/itineraries/${trip._id}/days/reorder`)
        .send({ dayIds: [otherDayId.toUpperCase(), dayId.toUpperCase()] })
        .expect(200)
    ).body;
    expect(reordered.days.map((day: { id: string }) => day.id)).toEqual([
      otherDayId,
      dayId,
    ]);
    await owner
      .delete(`/api/activities/${activityId.toUpperCase()}`)
      .expect(200);
    const removed = (
      await owner
        .delete(`/api/itineraries/${trip._id}/days/${dayId.toUpperCase()}`)
        .expect(200)
    ).body;
    expect(removed.days.map((day: { id: string }) => day.id)).toEqual([
      otherDayId,
    ]);
  });

  it('rejects activity-total overflow without losing existing data', async () => {
    const owner = await signIn();
    const trip = await create(owner);
    const day = (
      await owner
        .post(`/api/itineraries/${trip.id}/days`)
        .send({ cityId: 'cairo' })
        .expect(201)
    ).body.days[0];
    const path = `/api/itineraries/${trip.id}/days/${day.id}/activities`;
    await owner
      .post(path)
      .send({
        name: 'Large',
        cost: { amountMinor: Number.MAX_SAFE_INTEGER, currency: 'EGP' },
      })
      .expect(201);
    await owner
      .post(path)
      .send({ name: 'Overflow', cost: { amountMinor: 1, currency: 'EGP' } })
      .expect(400);
    const stored = (await owner.get(`/api/itineraries/${trip.id}`).expect(200))
      .body;
    expect(stored.days[0].activities).toHaveLength(1);
    expect(stored.cityGroups[0].activityTotals).toEqual({
      EGP: Number.MAX_SAFE_INTEGER,
    });
  });

  it('rejects dates beyond the four-digit calendar range without changing the stored days', async () => {
    const owner = await signIn();
    const trip = (
      await owner
        .post('/api/itineraries')
        .send({ ...base, startDate: '9999-12-31' })
        .expect(201)
    ).body;
    await owner
      .post(`/api/itineraries/${trip.id}/days`)
      .send({ cityId: 'cairo' })
      .expect(201);
    await owner
      .post(`/api/itineraries/${trip.id}/days`)
      .send({ cityId: 'cairo' })
      .expect(400);
    expect(
      (await owner.get(`/api/itineraries/${trip.id}`).expect(200)).body.days,
    ).toHaveLength(1);
  });

  it('paginates public results and escapes title search while matching official country names', async () => {
    await itineraries.insertMany(
      Array.from({ length: 11 }, (_, index) => ({
        ...base,
        ownerId,
        visibility: 'public',
        title: index === 0 ? '.* Literal' : `Journey ${index}`,
      })),
    );
    await itineraries.create({ ...base, ownerId, visibility: 'private' });
    const first = (
      await request(app.getHttpServer())
        .get('/api/itineraries/public/search')
        .expect(200)
    ).body;
    const second = (
      await request(app.getHttpServer())
        .get('/api/itineraries/public/search?page=2')
        .expect(200)
    ).body;
    expect(first.meta).toEqual({
      page: 1,
      limit: 10,
      total: 11,
      totalPages: 2,
    });
    expect(first.data).toHaveLength(10);
    expect(second.data).toHaveLength(1);
    const literal = (
      await request(app.getHttpServer())
        .get('/api/itineraries/public/search')
        .query({ search: '.*' })
        .expect(200)
    ).body;
    expect(literal.meta.total).toBe(1);
    const country = (
      await request(app.getHttpServer())
        .get('/api/itineraries/public/search')
        .query({ search: 'Egypt' })
        .expect(200)
    ).body;
    expect(country.meta.total).toBe(11);
  });
});
