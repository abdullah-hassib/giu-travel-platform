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
import { BudgetingModule } from '../src/modules/budgeting/budgeting.module';
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
        BudgetingModule,
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
      images: [],
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

  async function prepareBudgetTrip() {
    const owner = await signIn();
    const trip = await create(owner);
    await owner
      .post(`/api/itineraries/${trip.id}/days`)
      .send({ cityId: 'cairo' })
      .expect(201);
    const added = (
      await owner
        .post(`/api/itineraries/${trip.id}/days`)
        .send({ cityId: 'paris' })
        .expect(201)
    ).body;
    return { owner, trip: added, first: added.days[0], second: added.days[1] };
  }

  it('calculates all native-currency categories and recalculates after moves, reorder and deletion', async () => {
    const { owner, trip, first, second } = await prepareBudgetTrip();
    await owner
      .post(`/api/itineraries/${trip.id}/days/${first.id}/activities`)
      .send({ name: 'Museum', cost: { amountMinor: 100, currency: 'USD' } })
      .expect(201);
    await owner
      .post(`/api/itineraries/${trip.id}/days/${second.id}/activities`)
      .send({ name: 'Gallery', cost: { amountMinor: 100, currency: 'EUR' } })
      .expect(201);
    let foodId = '';
    for (const [category, amountMinor] of [
      ['food', 200],
      ['accommodation', 300],
      ['in_city_transport', 50],
      ['activities', 20],
    ] as const) {
      const added = (
        await owner
          .post(`/api/itineraries/${trip.id}/days/${first.id}/budgets`)
          .send({ category, amountMinor, currency: 'USD' })
          .expect(201)
      ).body;
      if (category === 'food') foodId = added.days[0].budgets[0].id;
    }
    await owner
      .post(`/api/itineraries/${trip.id}/days/${second.id}/budgets`)
      .send({ category: 'food', amountMinor: 400, currency: 'EUR' })
      .expect(201);
    const transport = (
      await owner
        .post(`/api/itineraries/${trip.id}/transport-costs`)
        .send({
          dayId: first.id,
          mode: 'flight',
          fromCityId: 'cairo',
          toCityId: 'paris',
          amountMinor: 500,
          currency: 'USD',
        })
        .expect(201)
    ).body.days[0].transportCosts[0];
    await owner
      .post(`/api/itineraries/${trip.id}/transport-costs`)
      .send({
        dayId: second.id,
        mode: 'train',
        fromCityId: 'paris',
        toCityId: 'london',
        amountMinor: 600,
        currency: 'EUR',
      })
      .expect(201);
    const summary = (
      await owner.get(`/api/itineraries/${trip.id}/budget-summary`).expect(200)
    ).body;
    expect(summary.totalByCurrency).toEqual({ USD: 1170, EUR: 1100 });
    expect(summary.byCategory.activities).toEqual({ USD: 120, EUR: 100 });
    expect(summary.byCategory.intercity_transport).toEqual({
      USD: 500,
      EUR: 600,
    });
    expect(summary.byDay.map((day: { date: string }) => day.date)).toEqual([
      '2028-02-28',
      '2028-02-29',
    ]);
    const view = (await owner.get(`/api/itineraries/${trip.id}`).expect(200))
      .body;
    expect(view.cityGroups[0].budgetTotals).toEqual({ USD: 1170 });
    expect(view.cityGroups[0].activityTotals).toEqual({ USD: 100 });
    await owner
      .patch(`/api/budgets/${foodId}`)
      .send({ amountMinor: 250, currency: 'EGP' })
      .expect(200);
    const moved = (
      await owner
        .patch(`/api/transport-costs/${transport.id}`)
        .send({
          dayId: second.id,
          mode: ' coach ',
          amountMinor: 700,
          currency: 'GBP',
        })
        .expect(200)
    ).body;
    expect(moved.days[0].transportCosts).toEqual([]);
    expect(
      moved.days[1].transportCosts.find(
        (entry: { id: string }) => entry.id === transport.id,
      ),
    ).toMatchObject({ id: transport.id, dayId: second.id, mode: 'coach' });
    const reordered = (
      await owner
        .patch(`/api/itineraries/${trip.id}/days/reorder`)
        .send({ dayIds: [second.id, first.id] })
        .expect(200)
    ).body;
    expect(reordered.budgetSummary.byDay[0]).toMatchObject({
      dayId: second.id,
      dayNumber: 1,
      date: '2028-02-28',
      totalByCurrency: { EUR: 1100, GBP: 700 },
    });
    await owner.delete(`/api/budgets/${foodId.toUpperCase()}`).expect(200);
    const deleted = (
      await owner
        .delete(`/api/itineraries/${trip.id}/days/${second.id}`)
        .expect(200)
    ).body;
    expect(deleted.budgetSummary.totalByCurrency).toEqual({ USD: 470 });
    expect(deleted.cityGroups[0].budgetTotals).toEqual({ USD: 470 });
    expect(deleted.budgetSummary.byDay).toHaveLength(1);
  });

  it('supports zero costs, currency/category edits and entry deletion', async () => {
    const { owner, trip, first, second } = await prepareBudgetTrip();
    const budget = (
      await owner
        .post(`/api/itineraries/${trip.id}/days/${first.id}/budgets`)
        .send({ category: 'food', amountMinor: 0, currency: 'USD' })
        .expect(201)
    ).body.days[0].budgets[0];
    const transport = (
      await owner
        .post(`/api/itineraries/${trip.id}/transport-costs`)
        .send({
          dayId: first.id,
          mode: 'bus',
          fromCityId: 'cairo',
          toCityId: 'dubai',
          amountMinor: 0,
          currency: 'GBP',
        })
        .expect(201)
    ).body.days[0].transportCosts[0];
    await owner
      .patch(`/api/budgets/${budget.id.toUpperCase()}`)
      .send({ category: 'accommodation', amountMinor: 99, currency: 'EUR' })
      .expect(200);
    await owner
      .patch(`/api/transport-costs/${transport.id.toUpperCase()}`)
      .send({
        dayId: second.id.toUpperCase(),
        amountMinor: 100,
        currency: 'AED',
      })
      .expect(200);
    const summary = (
      await owner.get(`/api/itineraries/${trip.id}/budget-summary`).expect(200)
    ).body;
    expect(summary.totalByCurrency).toEqual({ EUR: 99, AED: 100 });
    expect(summary.byCategory.accommodation).toEqual({ EUR: 99 });
    await owner.delete(`/api/budgets/${budget.id}`).expect(200);
    const removed = (
      await owner.delete(`/api/transport-costs/${transport.id}`).expect(200)
    ).body;
    expect(removed.budgetSummary.totalByCurrency).toEqual({});
  });

  it('clones budgets and transport with new identifiers and correct day references', async () => {
    const { owner, trip, first } = await prepareBudgetTrip();
    const budget = (
      await owner
        .post(`/api/itineraries/${trip.id}/days/${first.id}/budgets`)
        .send({ category: 'food', amountMinor: 100, currency: 'EGP' })
        .expect(201)
    ).body.days[0].budgets[0];
    const transport = (
      await owner
        .post(`/api/itineraries/${trip.id}/transport-costs`)
        .send({
          dayId: first.id,
          mode: 'bus',
          fromCityId: 'cairo',
          toCityId: 'dubai',
          amountMinor: 200,
          currency: 'EGP',
        })
        .expect(201)
    ).body.days[0].transportCosts[0];
    await owner
      .patch(`/api/itineraries/${trip.id}`)
      .send({ visibility: 'public' })
      .expect(200);
    const visible = (
      await request(app.getHttpServer())
        .get(`/api/itineraries/public/${trip.id}`)
        .expect(200)
    ).body;
    expect(visible.budgetSummary.totalByCurrency).toEqual({ EGP: 300 });
    const other = await signIn('other@example.com');
    const clone = (
      await other.post(`/api/itineraries/${trip.id}/clone`).expect(201)
    ).body;
    expect(clone.days[0].budgets[0].id).not.toBe(budget.id);
    expect(clone.days[0].transportCosts[0].id).not.toBe(transport.id);
    expect(clone.days[0].transportCosts[0].dayId).toBe(clone.days[0].id);
    expect(clone.budgetSummary.totalByCurrency).toEqual({ EGP: 300 });
    await other
      .patch(`/api/budgets/${clone.days[0].budgets[0].id}`)
      .send({ amountMinor: 500 })
      .expect(200);
    expect(
      (
        await owner
          .get(`/api/itineraries/${trip.id}/budget-summary`)
          .expect(200)
      ).body.totalByCurrency,
    ).toEqual({ EGP: 300 });
    await owner.delete(`/api/itineraries/${trip.id}`).expect(204);
    expect(
      (
        await other
          .get(`/api/itineraries/${clone.id}/budget-summary`)
          .expect(200)
      ).body.totalByCurrency,
    ).toEqual({ EGP: 700 });
  });

  it('enforces owner boundaries for all budget and transport operations', async () => {
    const { owner, trip, first } = await prepareBudgetTrip();
    const budget = (
      await owner
        .post(`/api/itineraries/${trip.id}/days/${first.id}/budgets`)
        .send({ category: 'food', amountMinor: 100, currency: 'EGP' })
        .expect(201)
    ).body.days[0].budgets[0];
    const transportBody = {
      dayId: first.id,
      mode: 'bus',
      fromCityId: 'cairo',
      toCityId: 'dubai',
      amountMinor: 200,
      currency: 'EGP',
    };
    const transport = (
      await owner
        .post(`/api/itineraries/${trip.id}/transport-costs`)
        .send(transportBody)
        .expect(201)
    ).body.days[0].transportCosts[0];
    const other = await signIn('other@example.com');
    await other.get(`/api/itineraries/${trip.id}/budget-summary`).expect(404);
    await other
      .post(`/api/itineraries/${trip.id}/days/${first.id}/budgets`)
      .send({ category: 'food', amountMinor: 1, currency: 'EGP' })
      .expect(404);
    await other
      .post(`/api/itineraries/${trip.id}/transport-costs`)
      .send(transportBody)
      .expect(404);
    await other
      .patch(`/api/budgets/${budget.id}`)
      .send({ amountMinor: 1 })
      .expect(404);
    await other.delete(`/api/budgets/${budget.id}`).expect(404);
    await other
      .patch(`/api/transport-costs/${transport.id}`)
      .send({ amountMinor: 1 })
      .expect(404);
    await other.delete(`/api/transport-costs/${transport.id}`).expect(404);
    await request(app.getHttpServer())
      .get(`/api/itineraries/${trip.id}/budget-summary`)
      .expect(401);
  });

  it.each(['admin', 'airline_moderator', 'hotel_moderator'])(
    'denies a %s-only budget client',
    async (role) => {
      const { trip, first } = await prepareBudgetTrip();
      await users.create({
        email: 'staff@example.com',
        fullName: 'Staff',
        passwordHash,
        roles: [role],
      });
      const staff = await signIn('staff@example.com');
      await staff.get(`/api/itineraries/${trip.id}/budget-summary`).expect(403);
      await staff
        .post(`/api/itineraries/${trip.id}/days/${first.id}/budgets`)
        .send({ category: 'food', amountMinor: 1, currency: 'EGP' })
        .expect(403);
    },
  );

  it.each([
    { category: 'unknown' },
    { amountMinor: -1 },
    { amountMinor: 1.5 },
    { amountMinor: null },
    { amountMinor: Number.MAX_SAFE_INTEGER + 1 },
    { currency: 'ZZZ' },
    { category: null },
    { category: undefined },
    { ownerId: 'injected' },
  ])('validates budget entries %p', async (fields) => {
    const { owner, trip, first } = await prepareBudgetTrip();
    await owner
      .post(`/api/itineraries/${trip.id}/days/${first.id}/budgets`)
      .send({ category: 'food', amountMinor: 100, currency: 'EGP', ...fields })
      .expect(400);
  });

  it.each([
    { mode: '  ' },
    { fromCityId: 'unknown' },
    { toCityId: 'unknown' },
    { dayId: 'invalid' },
    { amountMinor: -1 },
    { mode: null },
  ])('validates transport entries %p', async (fields) => {
    const { owner, trip, first } = await prepareBudgetTrip();
    await owner
      .post(`/api/itineraries/${trip.id}/transport-costs`)
      .send({
        dayId: first.id,
        mode: 'train',
        fromCityId: 'cairo',
        toCityId: 'paris',
        amountMinor: 100,
        currency: 'EGP',
        ...fields,
      })
      .expect(400);
  });

  it('rejects null patches, foreign day moves and unsupported conversion queries', async () => {
    const { owner, trip, first } = await prepareBudgetTrip();
    const budget = (
      await owner
        .post(`/api/itineraries/${trip.id}/days/${first.id}/budgets`)
        .send({ category: 'food', amountMinor: 100, currency: 'EGP' })
        .expect(201)
    ).body.days[0].budgets[0];
    const transport = (
      await owner
        .post(`/api/itineraries/${trip.id}/transport-costs`)
        .send({
          dayId: first.id,
          mode: 'bus',
          fromCityId: 'cairo',
          toCityId: 'paris',
          amountMinor: 200,
          currency: 'EGP',
        })
        .expect(201)
    ).body.days[0].transportCosts[0];
    await owner
      .patch(`/api/budgets/${budget.id}`)
      .send({ currency: null })
      .expect(400);
    await owner
      .patch(`/api/transport-costs/${transport.id}`)
      .send({ amountMinor: null })
      .expect(400);
    const foreignTrip = await create(owner);
    const foreignDay = (
      await owner
        .post(`/api/itineraries/${foreignTrip.id}/days`)
        .send({ cityId: 'cairo' })
        .expect(201)
    ).body.days[0];
    await owner
      .patch(`/api/transport-costs/${transport.id}`)
      .send({ dayId: foreignDay.id, mode: 'bad change' })
      .expect(404);
    expect(
      (await owner.get(`/api/itineraries/${trip.id}`).expect(200)).body.days[0]
        .transportCosts[0].mode,
    ).toBe('bus');
    await owner
      .get(`/api/itineraries/${trip.id}/budget-summary?currency=USD`)
      .expect(400);
  });

  it('rejects overflow across all cost sources atomically', async () => {
    const { owner, trip, first } = await prepareBudgetTrip();
    await owner
      .post(`/api/itineraries/${trip.id}/days/${first.id}/budgets`)
      .send({
        category: 'food',
        amountMinor: Number.MAX_SAFE_INTEGER,
        currency: 'EGP',
      })
      .expect(201);
    await owner
      .post(`/api/itineraries/${trip.id}/days/${first.id}/activities`)
      .send({ name: 'Overflow', cost: { amountMinor: 1, currency: 'EGP' } })
      .expect(400);
    await owner
      .post(`/api/itineraries/${trip.id}/transport-costs`)
      .send({
        dayId: first.id,
        mode: 'bus',
        fromCityId: 'cairo',
        toCityId: 'paris',
        amountMinor: 1,
        currency: 'EGP',
      })
      .expect(400);
    const stored = (await owner.get(`/api/itineraries/${trip.id}`).expect(200))
      .body;
    expect(stored.days[0].activities).toEqual([]);
    expect(stored.days[0].transportCosts).toEqual([]);
    expect(stored.budgetSummary.totalByCurrency).toEqual({
      EGP: Number.MAX_SAFE_INTEGER,
    });
  });

  it('reads legacy itineraries lacking the new monetary arrays', async () => {
    const id = new Types.ObjectId();
    await itineraries.collection.insertOne({
      _id: id,
      ...base,
      ownerId: new Types.ObjectId(ownerId),
      visibility: 'public',
      days: [
        {
          _id: new Types.ObjectId(),
          cityId: 'cairo',
          notes: '',
          activities: [
            {
              _id: new Types.ObjectId(),
              name: 'Old activity',
              description: '',
              cost: { amountMinor: 50, currency: 'EUR' },
            },
          ],
        },
      ],
      createdAt: new Date(),
      updatedAt: new Date(),
      __v: 0,
    });
    const owner = await signIn();
    expect(
      (await owner.get(`/api/itineraries/${id}/budget-summary`).expect(200))
        .body.totalByCurrency,
    ).toEqual({ EUR: 50 });
    const publicView = (
      await request(app.getHttpServer())
        .get(`/api/itineraries/public/${id}`)
        .expect(200)
    ).body;
    expect(publicView.days[0].budgets).toEqual([]);
    expect(publicView.days[0].transportCosts).toEqual([]);
    expect(publicView.cityGroups[0].budgetTotals).toEqual({ EUR: 50 });
  });

  it('documents original-currency summary and monetary routes in Swagger', async () => {
    const schema = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    expect(schema.paths['/api/budgets/{id}'].patch.security).toEqual([
      { giu_session: [] },
    ]);
    expect(
      schema.paths['/api/itineraries/{id}/budget-summary'].get.responses['200']
        .content['application/json'].schema.$ref,
    ).toContain('BudgetSummaryDto');
    expect(
      schema.components.schemas.CreateBudgetDto.properties.currency.enum,
    ).toContain('EGP');
  });

  it('rejects a raced budget write/day deletion without losing committed data', async () => {
    const { trip, first } = await prepareBudgetTrip();
    const a = await itineraries.findById(trip.id).orFail();
    const b = await itineraries.findById(trip.id).orFail();
    jest
      .spyOn(itineraries, 'findOne')
      .mockReturnValueOnce({ exec: async () => a } as never)
      .mockReturnValueOnce({ exec: async () => b } as never);
    const service = app.get(ItinerariesService);
    const results = await Promise.allSettled([
      service.addBudget(ownerId, trip.id, first.id, {
        category: 'food',
        amountMinor: 100,
        currency: 'EGP',
      }),
      service.deleteDay(ownerId, trip.id, first.id),
    ]);
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    const rejection = results.find((result) => result.status === 'rejected');
    expect(rejection?.status === 'rejected' && rejection.reason.status).toBe(
      409,
    );
    const stored = await itineraries.findById(trip.id).orFail();
    const remaining = stored.days.find((day) => day._id.equals(first.id));
    expect(remaining ? remaining.budgets.length : 0).toBe(remaining ? 1 : 0);
    expect(stored.days.length).toBe(remaining ? 2 : 1);
  });

  it('blocks budget access during mandatory password change', async () => {
    const { owner, trip, first } = await prepareBudgetTrip();
    await users.updateOne(
      { _id: ownerId },
      { $set: { mustChangePassword: true } },
    );
    await owner.get(`/api/itineraries/${trip.id}/budget-summary`).expect(403);
    await owner
      .post(`/api/itineraries/${trip.id}/days/${first.id}/budgets`)
      .send({ category: 'food', amountMinor: 1, currency: 'EGP' })
      .expect(403);
    await owner
      .post(`/api/itineraries/${trip.id}/transport-costs`)
      .send({
        dayId: first.id,
        mode: 'bus',
        fromCityId: 'cairo',
        toCityId: 'paris',
        amountMinor: 1,
        currency: 'EGP',
      })
      .expect(403);
  });
});
