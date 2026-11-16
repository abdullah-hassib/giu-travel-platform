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
import { Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import request from 'supertest';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { hashPassword } from '../src/modules/auth/security/password';
import { User, UserRole } from '../src/modules/users/schemas/user.schema';
import { UserSession } from '../src/modules/auth/schemas/user-session.schema';
import { BudgetingModule } from '../src/modules/budgeting/budgeting.module';
import {
  DailyFxRates,
  FxRatesClient,
} from '../src/modules/budgeting/fx-rates.client';
import { FxRatesService } from '../src/modules/budgeting/fx-rates.service';
import { FxRateCache } from '../src/modules/budgeting/schemas/fx-rate-cache.schema';
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

// All HTTP guards/modules and the cache are real. Only the external FX provider
// is replaced with deterministic fixtures. No .env, shared Atlas or real FX calls.
describe('Preferred currency and daily FX cache (real HTTP/MongoDB)', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryServer;
  let app: INestApplication;
  let users: Model<User>;
  let sessions: Model<UserSession>;
  let itineraries: Model<Itinerary>;
  let cache: Model<FxRateCache>;
  let passwordHash: string;
  const rates = {
    USD: 1,
    EGP: 50,
    AED: 3.67,
    GBP: 0.5,
    EUR: 0.8,
    JPY: 150,
    SAR: 3.75,
  };
  const client = Object.assign(new FxRatesClient(new ConfigService()), {
    latest: jest.fn<Promise<DailyFxRates>, []>(),
  });
  const today = () => new Date().toISOString().slice(0, 10);
  const yesterday = () =>
    new Date(Date.now() - 86400000).toISOString().slice(0, 10);

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), { dbName: 'giu_fx_tests' }),
        BudgetingModule,
      ],
    })
      .overrideProvider(FxRatesClient)
      .useValue(client)
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
    itineraries = app.get(getModelToken(Itinerary.name));
    cache = app.get(getModelToken(FxRateCache.name));
    await Promise.all([
      users.init(),
      sessions.init(),
      itineraries.init(),
      cache.init(),
    ]);
    passwordHash = await hashPassword('test-password1');
  });

  beforeEach(async () => {
    await Promise.all([
      users.deleteMany({}),
      sessions.deleteMany({}),
      itineraries.deleteMany({}),
      cache.deleteMany({}),
    ]);
    await users.create({
      email: 'owner@example.com',
      fullName: 'Owner',
      passwordHash,
      preferredCurrency: 'EUR',
    });
    client.latest.mockReset().mockResolvedValue({ rates, rateDate: today() });
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

  async function tripWithFood(agent: Awaited<ReturnType<typeof signIn>>) {
    const trip = (
      await agent
        .post('/api/itineraries')
        .send({
          title: 'FX journey',
          countryCodes: ['EG', 'JP'],
          startDate: '2026-11-20',
        })
        .expect(201)
    ).body;
    const withDay = (
      await agent
        .post(`/api/itineraries/${trip.id}/days`)
        .send({ cityId: 'cairo' })
        .expect(201)
    ).body;
    const dayId = withDay.days[0].id;
    await agent
      .post(`/api/itineraries/${trip.id}/days/${dayId}/budgets`)
      .send({ category: 'food', amountMinor: 10000, currency: 'USD' })
      .expect(201);
    return { id: trip.id as string, dayId: dayId as string };
  }

  it('converts activity, daily budget and intercity costs with reconciling category/day totals', async () => {
    const agent = await signIn();
    const trip = await tripWithFood(agent);
    await agent
      .post(`/api/itineraries/${trip.id}/days/${trip.dayId}/activities`)
      .send({ name: 'Activity', cost: { amountMinor: 15000, currency: 'JPY' } })
      .expect(201);
    await agent
      .post(`/api/itineraries/${trip.id}/transport-costs`)
      .send({
        dayId: trip.dayId,
        fromCityId: 'cairo',
        toCityId: 'tokyo',
        mode: 'flight',
        amountMinor: 50000,
        currency: 'EGP',
      })
      .expect(201);
    const before = (await agent.get(`/api/itineraries/${trip.id}`).expect(200))
      .body;
    const response = await agent
      .get(`/api/itineraries/${trip.id}/budget-summary`)
      .expect(200);
    expect(response.body.totalByCurrency).toEqual({
      USD: 10000,
      JPY: 15000,
      EGP: 50000,
    });
    expect(response.body.converted).toMatchObject({
      currency: 'EUR',
      totalMinor: 16800,
      source: 'FXRatesAPI',
      rateDate: today(),
      fallback: false,
      stale: false,
    });
    expect(response.body.converted.byCategory).toEqual({
      food: 8000,
      accommodation: 0,
      activities: 8000,
      in_city_transport: 0,
      intercity_transport: 800,
    });
    expect(response.body.converted.byDay[0]).toMatchObject({
      dayId: trip.dayId,
      totalMinor: 16800,
    });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(
      (await agent.get(`/api/itineraries/${trip.id}`).expect(200)).body,
    ).toEqual(before);
  });

  it('reuses the persisted daily snapshot across summaries, currencies and service instances', async () => {
    const agent = await signIn();
    const trip = await tripWithFood(agent);
    const url = `/api/itineraries/${trip.id}/budget-summary`;
    await agent.get(url).expect(200);
    const first = (await agent.get(url).expect(200)).body.converted;
    await agent
      .patch('/api/users/me')
      .send({ preferredCurrency: 'JPY' })
      .expect(200);
    expect((await agent.get(url).expect(200)).body.converted).toMatchObject({
      currency: 'JPY',
      totalMinor: 15000,
    });
    const restarted = new FxRatesService(cache, client);
    expect(await restarted.current()).toMatchObject({
      rateDate: today(),
      fetchedAt: first.fetchedAt,
      rates,
    });
    expect(client.latest).toHaveBeenCalledTimes(1);
    expect(await cache.countDocuments()).toBe(1);
    const stored = await cache.findById(today()).orFail();
    expect(stored.status).toBe('ready');
    expect(Object.fromEntries(stored.rates!)).toEqual(rates);
  });

  it('fetches once for concurrent requests, even through separate service instances', async () => {
    client.latest.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return { rates, rateDate: today() };
    });
    const services = Array.from(
      { length: 8 },
      () => new FxRatesService(cache, client),
    );
    const results = await Promise.all(
      services.map((service) => service.current()),
    );
    expect(
      results.every(
        (result) => result.rates.EUR === 0.8 && result.fallback === false,
      ),
    ).toBe(true);
    expect(new Set(results.map((result) => result.fetchedAt)).size).toBe(1);
    expect(client.latest).toHaveBeenCalledTimes(1);
    expect(await cache.countDocuments()).toBe(1);
  });

  it('refreshes the next UTC day instead of reusing yesterday as fresh', async () => {
    await cache.create({
      _id: yesterday(),
      status: 'ready',
      rates: { ...rates, EUR: 0.7 },
      rateDate: yesterday(),
      fetchedAt: new Date(Date.now() - 86400000),
    });
    const agent = await signIn();
    const trip = await tripWithFood(agent);
    const response = await agent
      .get(`/api/itineraries/${trip.id}/budget-summary`)
      .expect(200);
    expect(response.body.converted).toMatchObject({
      totalMinor: 8000,
      fallback: false,
      rateDate: today(),
    });
    expect(client.latest).toHaveBeenCalledTimes(1);
    expect(await cache.countDocuments()).toBe(2);
  });

  it('falls back to the last successful database cache after provider failure', async () => {
    await cache.create({
      _id: yesterday(),
      status: 'ready',
      rates,
      rateDate: yesterday(),
      fetchedAt: new Date(Date.now() - 86400000),
    });
    client.latest.mockRejectedValue(new Error('private provider failure'));
    const agent = await signIn();
    const trip = await tripWithFood(agent);
    const url = `/api/itineraries/${trip.id}/budget-summary`;
    for (let index = 0; index < 2; index++) {
      const response = await agent.get(url).expect(200);
      expect(response.body.converted).toMatchObject({
        currency: 'EUR',
        totalMinor: 8000,
        fallback: true,
        stale: true,
        rateDate: yesterday(),
      });
      expect(JSON.stringify(response.body)).not.toContain('private');
    }
    expect(client.latest).toHaveBeenCalledTimes(1);
    expect((await cache.findById(today()).orFail()).status).toBe('failed');
  });

  it('returns a sanitized 503 without a cached rate and keeps original itinerary costs readable', async () => {
    client.latest.mockRejectedValue(
      new Error('provider-url-with-private-token'),
    );
    const agent = await signIn();
    const trip = await tripWithFood(agent);
    const response = await agent
      .get(`/api/itineraries/${trip.id}/budget-summary`)
      .expect(503);
    expect(response.body.message).toContain('no cached rates');
    expect(JSON.stringify(response.body)).not.toContain('private-token');
    const parent = await agent.get(`/api/itineraries/${trip.id}`).expect(200);
    expect(parent.body.budgetSummary.totalByCurrency).toEqual({ USD: 10000 });
  });

  it('uses the reported provider date when a successful daily response has older rates', async () => {
    client.latest.mockResolvedValue({ rates, rateDate: yesterday() });
    const agent = await signIn();
    const trip = await tripWithFood(agent);
    const response = await agent
      .get(`/api/itineraries/${trip.id}/budget-summary`)
      .expect(200);
    expect(response.body.converted).toMatchObject({
      rateDate: yesterday(),
      stale: true,
      fallback: false,
    });
  });

  it('recovers an interrupted fetch with one guarded retry after a minute', async () => {
    await cache.create({
      _id: today(),
      status: 'fetching',
      requestedAt: new Date(0),
    });
    await cache.create({
      _id: yesterday(),
      status: 'ready',
      rates,
      rateDate: yesterday(),
      fetchedAt: new Date(Date.now() - 86400000),
    });
    const snapshot = await app.get(FxRatesService).current();
    expect(snapshot).toMatchObject({ rateDate: today(), fallback: false });
    expect(client.latest).toHaveBeenCalledTimes(1);
    expect((await cache.findById(today()).orFail()).status).toBe('ready');
  });

  it('recovers an initial failure after backoff instead of requiring a database reset', async () => {
    client.latest.mockRejectedValueOnce(new Error('Temporary outage'));
    const service = app.get(FxRatesService);
    await expect(service.current()).rejects.toMatchObject({ status: 503 });
    await expect(service.current()).rejects.toMatchObject({ status: 503 });
    expect(client.latest).toHaveBeenCalledTimes(1);
    await cache.updateOne(
      { _id: today() },
      { $set: { requestedAt: new Date(0) } },
    );
    const results = await Promise.all(
      Array.from({ length: 8 }, () => service.current()),
    );
    expect(results.every((result) => result.fallback === false)).toBe(true);
    expect(client.latest).toHaveBeenCalledTimes(2);
  });

  it('prevents a superseded fetch from overwriting a recovered snapshot', async () => {
    let releaseFirst!: (snapshot: DailyFxRates) => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    client.latest.mockImplementationOnce(
      () =>
        new Promise<DailyFxRates>((resolve) => {
          releaseFirst = resolve;
          markStarted();
        }),
    );
    const service = app.get(FxRatesService);
    const first = service.current();
    await started;
    await cache.updateOne(
      { _id: today() },
      { $set: { requestedAt: new Date(0) } },
    );
    const recovered = await new FxRatesService(cache, client).current();
    releaseFirst({ rates: { ...rates, EUR: 0.7 }, rateDate: today() });
    expect((await first).rates.EUR).toBe(0.8);
    expect(recovered.rates.EUR).toBe(0.8);
    expect((await cache.findById(today()).orFail()).rates?.get('EUR')).toBe(
      0.8,
    );
  });

  it('keeps the existing native response for a profile without preferred currency', async () => {
    await users.updateOne(
      { email: 'owner@example.com' },
      { $set: { preferredCurrency: null } },
    );
    const agent = await signIn();
    const trip = await tripWithFood(agent);
    const response = await agent
      .get(`/api/itineraries/${trip.id}/budget-summary`)
      .expect(200);
    expect(response.body.totalByCurrency).toEqual({ USD: 10000 });
    expect(response.body).not.toHaveProperty('converted');
    expect(client.latest).not.toHaveBeenCalled();
  });

  it.each([
    'traveler',
    'admin',
    'airline_moderator',
    'hotel_moderator',
  ] as UserRole[])(
    'denies private access to a different %s before any rate request',
    async (role) => {
      const owner = await signIn();
      const trip = await tripWithFood(owner);
      await users.create({
        email: 'other@example.com',
        fullName: 'Other',
        passwordHash,
        preferredCurrency: 'EUR',
        roles: [role],
      });
      const other = await signIn('other@example.com');
      await other
        .get(`/api/itineraries/${trip.id}/budget-summary`)
        .expect(role === 'traveler' ? 404 : 403);
      expect(client.latest).not.toHaveBeenCalled();
    },
  );

  it('denies guests, restricted sessions and unsupported conversion query fields before fetching', async () => {
    const agent = await signIn();
    const trip = await tripWithFood(agent);
    const url = `/api/itineraries/${trip.id}/budget-summary`;
    await request(app.getHttpServer()).get(url).expect(401);
    await agent.get(`${url}?currency=USD`).expect(400);
    await users.updateOne(
      { email: 'owner@example.com' },
      { $set: { mustChangePassword: true } },
    );
    await agent.get(url).expect(403);
    expect(client.latest).not.toHaveBeenCalled();
  });

  it('rejects unsafe converted totals without changing the stored native amounts', async () => {
    const agent = await signIn();
    const trip = await tripWithFood(agent);
    await users.updateOne(
      { email: 'owner@example.com' },
      { $set: { preferredCurrency: 'EGP' } },
    );
    await itineraries.collection.updateOne(
      { _id: (await itineraries.findOne().orFail())._id },
      { $set: { 'days.0.budgets.0.amountMinor': Number.MAX_SAFE_INTEGER } },
    );
    await agent.get(`/api/itineraries/${trip.id}/budget-summary`).expect(400);
    expect(
      (await itineraries.findOne().orFail()).days[0].budgets[0].amountMinor,
    ).toBe(Number.MAX_SAFE_INTEGER);
  });

  it('converts empty and zero budgets consistently', async () => {
    const agent = await signIn();
    const trip = await tripWithFood(agent);
    await itineraries.updateOne(
      { _id: (await itineraries.findOne().orFail())._id },
      { $set: { 'days.0.budgets.0.amountMinor': 0 } },
    );
    const summary = (
      await agent.get(`/api/itineraries/${trip.id}/budget-summary`).expect(200)
    ).body;
    expect(summary.converted.totalMinor).toBe(0);
    const empty = (
      await agent
        .post('/api/itineraries')
        .send({ title: 'Empty', countryCodes: ['EG'], startDate: '2026-11-20' })
        .expect(201)
    ).body;
    expect(
      (
        await agent
          .get(`/api/itineraries/${empty.id}/budget-summary`)
          .expect(200)
      ).body.converted.byDay,
    ).toEqual([]);
    expect(client.latest).toHaveBeenCalledTimes(1);
  });

  it('uses the clone owner preference without altering source amounts or privacy', async () => {
    const owner = await signIn();
    const trip = await tripWithFood(owner);
    await owner
      .patch(`/api/itineraries/${trip.id}`)
      .send({ visibility: 'public' })
      .expect(200);
    await users.create({
      email: 'other@example.com',
      fullName: 'Other',
      passwordHash,
      preferredCurrency: 'JPY',
    });
    const other = await signIn('other@example.com');
    const clone = (
      await other.post(`/api/itineraries/${trip.id}/clone`).expect(201)
    ).body;
    const summary = (
      await other.get(`/api/itineraries/${clone.id}/budget-summary`).expect(200)
    ).body;
    expect(summary.converted).toMatchObject({
      currency: 'JPY',
      totalMinor: 15000,
    });
    expect(clone.visibility).toBe('private');
    expect(summary.totalByCurrency).toEqual({ USD: 10000 });
  });

  it('recalculates converted totals after cost edits, day reordering and deletion without fetching again', async () => {
    const agent = await signIn();
    const trip = await tripWithFood(agent);
    const second = (
      await agent
        .post(`/api/itineraries/${trip.id}/days`)
        .send({ cityId: 'tokyo' })
        .expect(201)
    ).body.days[1];
    await agent
      .post(`/api/itineraries/${trip.id}/days/${second.id}/budgets`)
      .send({ category: 'food', amountMinor: 2500, currency: 'JPY' })
      .expect(201);
    const url = `/api/itineraries/${trip.id}/budget-summary`;
    expect((await agent.get(url).expect(200)).body.converted.totalMinor).toBe(
      9333,
    );
    await agent
      .patch(`/api/itineraries/${trip.id}/days/reorder`)
      .send({ dayIds: [second.id, trip.dayId] })
      .expect(200);
    const reordered = (await agent.get(url).expect(200)).body.converted;
    expect(
      reordered.byDay.map((day: { totalMinor: number }) => day.totalMinor),
    ).toEqual([1333, 8000]);
    expect(reordered.byDay.map((day: { date: string }) => day.date)).toEqual([
      '2026-11-20',
      '2026-11-21',
    ]);
    await agent
      .delete(`/api/itineraries/${trip.id}/days/${second.id}`)
      .expect(200);
    const parent = (await agent.get(`/api/itineraries/${trip.id}`).expect(200))
      .body;
    await agent
      .patch(`/api/budgets/${parent.days[0].budgets[0].id}`)
      .send({ amountMinor: 20000 })
      .expect(200);
    expect((await agent.get(url).expect(200)).body.converted.totalMinor).toBe(
      16000,
    );
    expect(client.latest).toHaveBeenCalledTimes(1);
  });

  it('rejects a combined converted total that overflows even when individual conversions are safe', async () => {
    const agent = await signIn();
    const trip = await tripWithFood(agent);
    await agent
      .post(`/api/itineraries/${trip.id}/days/${trip.dayId}/budgets`)
      .send({
        category: 'accommodation',
        amountMinor: Number.MAX_SAFE_INTEGER,
        currency: 'GBP',
      })
      .expect(201);
    const parent = await itineraries.findOne().orFail();
    await itineraries.collection.updateOne(
      { _id: parent._id },
      { $set: { 'days.0.budgets.0.amountMinor': Number.MAX_SAFE_INTEGER } },
    );
    // With equal USD/GBP rates each conversion fits, their combined EUR total does not.
    client.latest.mockResolvedValue({
      rates: { ...rates, GBP: 1 },
      rateDate: today(),
    });
    await agent.get(`/api/itineraries/${trip.id}/budget-summary`).expect(400);
  });

  it('documents native and converted schemas with rate provenance and unavailable errors', async () => {
    const document = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    const operation =
      document.paths['/api/itineraries/{id}/budget-summary'].get;
    expect(operation.responses['503']).toBeDefined();
    const converted =
      document.components.schemas.ConvertedBudgetSummaryDto.properties;
    expect(Object.keys(converted)).toEqual(
      expect.arrayContaining([
        'currency',
        'totalMinor',
        'byDay',
        'byCategory',
        'rateDate',
        'fetchedAt',
        'stale',
        'fallback',
      ]),
    );
    expect(
      document.components.schemas.BudgetSummaryDto.properties,
    ).toHaveProperty('totalByCurrency');
  });
});
