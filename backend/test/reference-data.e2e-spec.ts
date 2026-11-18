import { INestApplication, ValidationPipe } from '@nestjs/common';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { Connection, createConnection } from 'mongoose';
import request from 'supertest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolve } from 'node:path';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { ReferenceDataModule } from '../src/modules/reference-data/reference-data.module';
import { ReferenceDataService } from '../src/modules/reference-data/reference-data.service';
import { seedOfficialReferences } from '../src/modules/reference-data/reference-seed';
import { loadOfficialReferenceDataset } from '../src/modules/reference-data/reference-dataset';
import { referenceModels } from '../src/modules/reference-data/reference.schema';
import { REFERENCE_SOURCE_ID } from '../src/modules/reference-data/official-reference';

const execute = promisify(execFile);
describe('Official reference data (HTTP, real MongoDB and seed CLI)', () => {
  jest.setTimeout(180000);
  let server: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let models: ReturnType<typeof referenceModels>;
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(server.getUri(), {
          dbName: 'giu_reference_tests',
        }),
        ReferenceDataModule,
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
    connection = app.get(getConnectionToken());
    models = referenceModels(connection);
    await Promise.all(Object.values(models).map((model) => model.init()));
  });
  beforeEach(async () => {
    await Promise.all(
      Object.values(models).map((model) => model.collection.deleteMany({})),
    );
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    await server?.stop();
  });

  it('reports unseeded references as unavailable instead of inventing empty official data', async () => {
    for (const path of [
      'countries',
      'cities',
      'airports',
      'attractions',
      'currencies',
      'airports/CAI',
    ])
      await request(app.getHttpServer())
        .get('/api/' + path)
        .expect(503);
    await models.state.create({
      _id: REFERENCE_SOURCE_ID,
      checksum: 'outdated-edition',
      seededAt: new Date(),
      counts: {},
    });
    await request(app.getHttpServer()).get('/api/airports').expect(503);
  });
  it('seeds all official records with natural identifiers and valid relationships', async () => {
    expect(await seedOfficialReferences(connection)).toEqual({
      countries: 8,
      cities: 8,
      airports: 8,
      attractions: 8,
      currencies: 7,
    });
    const source = loadOfficialReferenceDataset();
    for (const row of source.countries)
      expect(
        (await models.countries.findById(row.code).orFail()).toObject(),
      ).toEqual({ _id: row.code, ...row });
    for (const row of source.cities)
      expect(
        (await models.cities.findById(row.city_id).orFail()).toObject(),
      ).toEqual({ _id: row.city_id, ...row });
    for (const row of source.airports)
      expect(
        (await models.airports.findById(row.iata_code).orFail()).toObject(),
      ).toEqual({ _id: row.iata_code, ...row });
    for (const row of source.attractions)
      expect(
        (
          await models.attractions.findById(row.attraction_id).orFail()
        ).toObject(),
      ).toEqual({ _id: row.attraction_id, ...row });
    expect(
      (await models.state.findById(REFERENCE_SOURCE_ID).orFail()).counts,
    ).toEqual({
      countries: 8,
      cities: 8,
      airports: 8,
      attractions: 8,
      currencies: 7,
    });
    // Natural source fields must remain unique even for a noncanonical _id.
    const duplicates = [
      [
        models.countries.collection,
        { ...source.countries[0], _id: 'fixture-country' },
      ],
      [models.cities.collection, { ...source.cities[0], _id: 'fixture-city' }],
      [
        models.airports.collection,
        { ...source.airports[0], _id: 'fixture-airport' },
      ],
      [
        models.attractions.collection,
        { ...source.attractions[0], _id: 'fixture-attraction' },
      ],
      [
        models.currencies.collection,
        { code: source.currencies[0], _id: 'fixture-currency' },
      ],
    ] as const;
    for (const [collection, duplicate] of duplicates)
      await expect(
        connection
          .collection<{ _id: string }>(collection.collectionName)
          .insertOne(duplicate),
      ).rejects.toMatchObject({ code: 11000 });
  });
  it('is idempotent across repeated and concurrent seeders and preserves unrelated data', async () => {
    await connection
      .collection('unrelated_fixture')
      .insertOne({ marker: 'preserve' });
    await Promise.all([
      seedOfficialReferences(connection),
      seedOfficialReferences(connection),
    ]);
    const original = await models.airports.find().sort({ _id: 1 }).lean();
    await Promise.all([
      seedOfficialReferences(connection),
      seedOfficialReferences(connection),
    ]);
    expect(await models.airports.find().sort({ _id: 1 }).lean()).toEqual(
      original,
    );
    expect(await models.countries.countDocuments()).toBe(8);
    expect(await models.cities.countDocuments()).toBe(8);
    expect(await models.attractions.countDocuments()).toBe(8);
    expect(await models.currencies.countDocuments()).toBe(7);
    expect(
      await connection
        .collection('unrelated_fixture')
        .findOne({ marker: 'preserve' }),
    ).not.toBeNull();
  });
  it('rolls back every reference collection and readiness if a batch cannot persist', async () => {
    jest
      .spyOn(models.airports, 'bulkWrite')
      .mockRejectedValueOnce(new Error('Controlled airport write failure'));
    await expect(seedOfficialReferences(connection)).rejects.toThrow(
      'Controlled airport write failure',
    );
    for (const model of Object.values(models))
      expect(await model.countDocuments()).toBe(0);
    await request(app.getHttpServer()).get('/api/airports').expect(503);
  });
  it('rejects an unreviewed dataset without any database mutation', async () => {
    const data = loadOfficialReferenceDataset();
    await expect(
      seedOfficialReferences(connection, {
        ...data,
        attractions: data.attractions.map((r) => ({
          ...r,
          name: 'unreviewed change',
        })),
      }),
    ).rejects.toThrow('reviewed official');
    expect(await models.state.countDocuments()).toBe(0);
    expect(await models.countries.countDocuments()).toBe(0);
  });
  it('restores changed source fields safely on rerun without changing natural IDs', async () => {
    await seedOfficialReferences(connection);
    await models.airports.updateOne(
      { _id: 'CAI' },
      { $set: { time_zone: 'UTC' } },
    );
    await seedOfficialReferences(connection);
    expect((await models.airports.findById('CAI').orFail()).time_zone).toBe(
      'Africa/Cairo',
    );
    expect(await models.airports.countDocuments()).toBe(8);
  });
  it.each(['countries', 'cities', 'airports', 'attractions', 'currencies'])(
    'exposes a public read-only paginated %s list with no persistence metadata',
    async (path) => {
      await seedOfficialReferences(connection);
      const result = await request(app.getHttpServer())
        .get('/api/' + path)
        .expect(200);
      const total = path === 'currencies' ? 7 : 8;
      expect(result.body.meta).toEqual({
        page: 1,
        limit: 10,
        total,
        totalPages: 1,
      });
      expect(result.body.data).toHaveLength(total);
      expect(
        result.body.data.every(
          (row: Record<string, unknown>) => !('_id' in row) && !('__v' in row),
        ),
      ).toBe(true);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(
        (
          await request(app.getHttpServer())
            .get('/api/' + path + '?page=2')
            .expect(200)
        ).body.data,
      ).toEqual([]);
      await request(app.getHttpServer())
        .post('/api/' + path)
        .send({})
        .expect(404);
    },
  );
  it('supports location filters, literal search, Unicode and complete airport time-zone detail', async () => {
    await seedOfficialReferences(connection);
    const airports = await request(app.getHttpServer())
      .get('/api/airports?countryCode=eg&cityId=CAIRO&search=cai')
      .expect(200);
    expect(airports.body.data).toEqual([
      {
        iata_code: 'CAI',
        name: 'Cairo International Airport',
        city_id: 'cairo',
        country_code: 'EG',
        time_zone: 'Africa/Cairo',
      },
    ]);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/cities?countryCode=DE')
          .expect(200)
      ).body.data[0].city_id,
    ).toBe('frankfurt');
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/attractions?countryCode=DE')
          .expect(200)
      ).body.data[0].name,
    ).toBe('Römerberg');
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/attractions?cityId=riyadh')
          .expect(200)
      ).body.data[0].attraction_id,
    ).toBe('att-7');
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/countries?search=united')
          .expect(200)
      ).body.meta.total,
    ).toBe(3);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/airports?search=.*')
          .expect(200)
      ).body.meta.total,
    ).toBe(0);
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/currencies?search=eur')
          .expect(200)
      ).body.data,
    ).toEqual([{ code: 'EUR' }]);
  });
  it('normalizes natural detail identifiers and exports reusable validated lookups', async () => {
    await seedOfficialReferences(connection);
    expect(
      (await request(app.getHttpServer()).get('/api/airports/jfk').expect(200))
        .body.time_zone,
    ).toBe('America/New_York');
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/cities/NEW_YORK')
          .expect(200)
      ).body.country_code,
    ).toBe('US');
    expect(
      (await request(app.getHttpServer()).get('/api/countries/eg').expect(200))
        .body.currency,
    ).toBe('EGP');
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/attractions/ATT-8')
          .expect(200)
      ).body.name,
    ).toBe('Römerberg');
    expect(
      (
        await request(app.getHttpServer())
          .get('/api/currencies/jpy')
          .expect(200)
      ).body.code,
    ).toBe('JPY');
    expect(
      (await app.get(ReferenceDataService).getAirport('lhr')).time_zone,
    ).toBe('Europe/London');
    await expect(
      app.get(ReferenceDataService).getCity('missing'),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('validates direct shared-service identifiers without relying on HTTP DTOs', async () => {
    const service = app.get(ReferenceDataService);
    for (const operation of [
      () => service.getAirport('CAI[$ne]'),
      () => service.getCountry('USA'),
      () => service.getCity('bad/id'),
      () => service.getAttraction(undefined as unknown as string),
      () => service.getCurrency('US'),
    ])
      await expect(operation()).rejects.toMatchObject({ status: 400 });
  });
  it('does not publish custom records even if unrelated rows already exist in reference collections', async () => {
    await seedOfficialReferences(connection);
    await models.airports.create({
      _id: 'XXX',
      iata_code: 'XXX',
      name: 'Isolated nonofficial fixture',
      city_id: 'cairo',
      country_code: 'EG',
      time_zone: 'Africa/Cairo',
    });
    await seedOfficialReferences(connection);
    expect(
      (await request(app.getHttpServer()).get('/api/airports').expect(200)).body
        .meta.total,
    ).toBe(8);
    await request(app.getHttpServer()).get('/api/airports/XXX').expect(404);
    expect(await models.airports.countDocuments()).toBe(9);
  });
  it.each([
    'airports?page=0',
    'airports?page=1.1',
    'airports?page=no',
    'airports?page=9007199254740991',
    'airports?limit=100',
    'airports?sortBy=time_zone',
    'airports?countryCode=USA',
    'airports?countryCode[$ne]=EG',
    'airports?cityId[$ne]=cairo',
    'airports?search[$ne]=a',
    'airports?cityId[]=cairo',
    'airports?search=' + 'x'.repeat(101),
    'cities?cityId=cairo',
    'countries?countryCode=EG',
    'airports/123',
    'cities/!invalid',
    'currencies/US',
  ])('rejects invalid or unsupported reference input %s', async (path) => {
    await request(app.getHttpServer())
      .get('/api/' + path)
      .expect(400);
  });
  it.each([
    'airports/ZZZ',
    'cities/missing',
    'countries/ZZ',
    'attractions/missing',
    'currencies/ZZZ',
    'cities?countryCode=ZZ',
    'airports?cityId=missing',
  ])('rejects nonexistent valid reference %s', async (path) => {
    await seedOfficialReferences(connection);
    await request(app.getHttpServer())
      .get('/api/' + path)
      .expect(404);
  });
  it('rejects a mismatched city/country filter', async () => {
    await seedOfficialReferences(connection);
    await request(app.getHttpServer())
      .get('/api/airports?cityId=cairo&countryCode=US')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/attractions?cityId=cairo&countryCode=US')
      .expect(400);
  });
  it('documents all public lookup schemas and exposes no mutation operation', async () => {
    const document = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    for (const path of [
      'countries',
      'cities',
      'airports',
      'attractions',
      'currencies',
    ]) {
      const operation = document.paths['/api/' + path];
      expect(Object.keys(operation)).toEqual(['get']);
      expect(operation.get.security).toBeUndefined();
      for (const code of ['200', '400', '404', '503'])
        expect(operation.get.responses[code]).toBeDefined();
    }
    expect(
      document.components.schemas.AirportDto.properties.time_zone,
    ).toBeDefined();
  });
  it('runs the compiled validation-only and apply CLI against a fresh disposable database, twice', async () => {
    const script = resolve(__dirname, '../dist/scripts/seed-reference.js');
    const env = {
      PATH: process.env.PATH,
      SystemRoot: process.env.SystemRoot,
      NODE_ENV: 'test',
      MONGODB_URI: server.getUri('giu_reference_cli'),
    };
    const dry = await execute(process.execPath, [script], { env });
    expect(JSON.parse(dry.stdout).mode).toBe('validate-only');
    const isolated = createConnection(env.MONGODB_URI);
    try {
      await isolated.asPromise();
      const isolatedModels = referenceModels(isolated);
      expect(await isolatedModels.state.countDocuments()).toBe(0);
      for (let attempt = 0; attempt < 2; attempt++) {
        const applied = await execute(process.execPath, [script, '--apply'], {
          env,
        });
        expect(JSON.parse(applied.stdout)).toMatchObject({
          mode: 'applied',
          counts: { airports: 8, currencies: 7 },
        });
      }
      expect(await isolatedModels.airports.countDocuments()).toBe(8);
      expect(await isolatedModels.currencies.countDocuments()).toBe(7);
      await expect(
        execute(process.execPath, [script, '--unsupported'], { env }),
      ).rejects.toMatchObject({ code: 1 });
    } finally {
      await isolated.close();
    }
  });
});
