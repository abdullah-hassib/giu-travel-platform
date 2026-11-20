import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { Connection, Model } from 'mongoose';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { environmentSchema } from '../src/config/env.validation';
import { hashPassword } from '../src/modules/auth/security/password';
import { configurePaymentBodyParsers } from '../src/modules/payments/payment-body-parsers';
import { PaymentEvent } from '../src/modules/payments/schemas/payment-event.schema';
import { UsersService } from '../src/modules/users/users.service';

const mediaRoot = mkdtempSync(join(tmpdir(), 'giu-full-app-'));

describe('Complete AppModule with disposable configuration and no environment-file loading', () => {
  jest.setTimeout(180_000);
  let app: INestApplication;
  let server: MongoMemoryReplSet;
  let targetId: string;

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      instanceOpts: [{ launchTimeout: 30_000 }],
    });
    const validation = environmentSchema.validate({
      NODE_ENV: 'test',
      MONGODB_URI: server.getUri('giu_complete_app'),
      MEDIA_UPLOAD_DIR: mediaRoot,
      STRIPE_SECRET_KEY: '',
      STRIPE_WEBHOOK_SECRET: '',
      FXRATES_API_KEY: '',
    });
    if (validation.error)
      throw new Error('Invalid disposable smoke-test configuration');
    const configuration = new ConfigService(validation.value);
    // Stub only configuration bootstrapping before importing AppModule. Never
    // invoke dotenv, read .env, modify process environment or use private settings.
    const configRoot = jest
      .spyOn(ConfigModule, 'forRoot')
      .mockResolvedValueOnce({
        module: ConfigModule,
        global: true,
        providers: [{ provide: ConfigService, useValue: configuration }],
        exports: [ConfigService],
      });
    try {
      const { AppModule } = await import('../src/app.module');
      const module = await Test.createTestingModule({ imports: [AppModule] })
        .overrideProvider(ConfigService)
        .useValue(configuration)
        .compile();
      app = module.createNestApplication({ bodyParser: false });
      configurePaymentBodyParsers(app);
      app.setGlobalPrefix('api');
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          forbidNonWhitelisted: true,
          transform: true,
          transformOptions: { enableImplicitConversion: false },
        }),
      );
      app.useGlobalFilters(new HttpErrorFilter());
      SwaggerModule.setup(
        'api/docs',
        app,
        SwaggerModule.createDocument(
          app,
          new DocumentBuilder()
            .setTitle('GIU Travel Platform API')
            .addCookieAuth(
              'giu_session',
              { type: 'apiKey', in: 'cookie', name: 'giu_session' },
              'giu_session',
            )
            .addCookieAuth(
              'giu_refresh',
              { type: 'apiKey', in: 'cookie', name: 'giu_refresh' },
              'giu_refresh',
            )
            .build(),
        ),
      );
      await app.init();
    } finally {
      configRoot.mockRestore();
    }
    const connection = app.get<Connection>(getConnectionToken());
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    const passwordHash = await hashPassword('smoke-password1');
    const users = app.get(UsersService);
    await users.seedAdministrator('smoke-admin@example.com', passwordHash);
    targetId = (
      await users.createTraveler(
        'smoke-target@example.com',
        'Smoke Target',
        passwordHash,
        new Date(),
      )
    )._id.toString();
  });
  afterAll(async () => {
    await app?.close();
    await server?.stop();
    if (!mediaRoot.startsWith(join(tmpdir(), 'giu-full-app-')))
      throw new Error('Unexpected cleanup path');
    rmSync(mediaRoot, { recursive: true, force: true });
  });

  it('publishes all 110 mandatory method/path pairs from the checksum-pinned official project PDF', async () => {
    const fixture = JSON.parse(
      readFileSync(join(__dirname, 'fixtures/mandatory-routes.json'), 'utf8'),
    ) as {
      sourceSha256: string;
      routes: { method: string; path: string; requirements: string[] }[];
    };
    expect(fixture.routes).toHaveLength(110);
    const checksum = createHash('sha256')
      .update(
        readFileSync(
          join(
            __dirname,
            '../../docs/requirements/official-giu-project-description.pdf',
          ),
        ),
      )
      .digest('hex');
    expect(checksum).toBe(fixture.sourceSha256);
    const doc: { paths: Record<string, Record<string, unknown>> } = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    const normalize = (path: string) => path.replace(/\{[^}]+\}/g, '{}');
    const available = new Set(
      Object.entries(doc.paths).flatMap(([path, operations]) =>
        Object.keys(operations).map((method) => method + ' ' + normalize(path)),
      ),
    );
    const missing = fixture.routes
      .filter(
        (route) => !available.has(route.method + ' ' + normalize(route.path)),
      )
      .map(
        (route) =>
          route.method.toUpperCase() +
          ' ' +
          route.path +
          ' (' +
          route.requirements.join(', ') +
          ')',
      );
    expect(missing).toEqual([]);
  });

  it('boots all actual modules and publishes Swagger UI, schemas, cookie access and available routes', async () => {
    await request(app.getHttpServer())
      .get('/api/health/live')
      .expect(200, { status: 'ok' });
    await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(200, { status: 'ok', database: 'connected' });
    const ui = await request(app.getHttpServer()).get('/api/docs').expect(200);
    expect(ui.text).toContain('Swagger UI');
    const doc = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    for (const path of [
      '/api/auth/refresh',
      '/api/admin/bookings',
      '/api/admin/audit-logs',
      '/api/admin/providers/{type}/{id}/deactivate',
      '/api/itineraries/{id}/hotels',
      '/api/activities/{id}/images',
      '/api/bookings/{type}/{id}/policies',
      '/api/payments/webhook',
      '/api/refunds/{id}',
      '/api/countries',
      '/api/reviews/{id}/reply',
    ]) {
      expect(doc.paths).toHaveProperty(path);
    }
    expect(doc.components.securitySchemes.giu_session.in).toBe('cookie');
    expect(doc.components.schemas).toHaveProperty('AdminHistoryPageDto');
    expect(doc.components.schemas).toHaveProperty('CreateReviewReplyDto');
    expect(doc.components.schemas).toHaveProperty('ReviewReplyViewDto');
  });

  it('runs registration, cookie rotation and an owned itinerary-to-hotel search through the full module graph', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/register')
      .send({
        email: 'smoke-traveler@example.com',
        fullName: 'Smoke Traveler',
        password: 'smoke-password1',
        termsAccepted: true,
      })
      .expect(201);
    await agent
      .post('/api/auth/login')
      .send({
        email: 'smoke-traveler@example.com',
        password: 'smoke-password1',
      })
      .expect(200);
    await agent.post('/api/auth/refresh').send({}).expect(200);
    await agent.get('/api/auth/me').expect(200);
    const tripId = (
      await agent
        .post('/api/itineraries')
        .send({
          title: 'Smoke Journey',
          countryCodes: ['EG'],
          startDate: '2028-01-01',
        })
        .expect(201)
    ).body.id;
    const dayId = (
      await agent
        .post(`/api/itineraries/${tripId}/days`)
        .send({ cityId: 'cairo' })
        .expect(201)
    ).body.days[0].id;
    const result = (
      await agent
        .get(`/api/itineraries/${tripId}/hotels`)
        .query({ dayId, guests: 1 })
        .expect(200)
    ).body;
    expect(result.selection).toMatchObject({
      cityId: 'cairo',
      checkIn: '2028-01-01',
      checkOut: '2028-01-02',
    });
    expect(result.data).toEqual([]);
  });

  it('runs real admin actions, both booking-domain reads and committed history', async () => {
    const admin = request.agent(app.getHttpServer());
    await admin
      .post('/api/auth/login')
      .send({ email: 'smoke-admin@example.com', password: 'smoke-password1' })
      .expect(200);
    expect(
      (await admin.get('/api/admin/accounts').expect(200)).body.meta.total,
    ).toBeGreaterThanOrEqual(2);
    expect(
      (await admin.get('/api/admin/bookings?type=hotel').expect(200)).body.data,
    ).toEqual([]);
    expect(
      (await admin.get('/api/admin/bookings?type=flight').expect(200)).body
        .data,
    ).toEqual([]);
    expect(
      (await admin.get('/api/admin/bookings').expect(200)).body.data,
    ).toEqual([]);
    await admin
      .patch(`/api/admin/accounts/${targetId}/suspend`)
      .send({})
      .expect(204);
    const history = (
      await admin
        .get('/api/admin/audit-logs')
        .query({ action: 'account.suspended' })
        .expect(200)
    ).body;
    expect(history.meta.total).toBe(1);
    expect(history.data[0]).toMatchObject({
      target: { type: 'account', id: targetId },
      outcome: 'committed',
      deliveryStatus: 'pending',
    });
  });

  it('fails safely for missing Stripe verification without persisting or applying a fabricated event', async () => {
    await request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', 't=1,v1=synthetic')
      .send('{"id":"evt_smoke"}')
      .expect(503);
    const events = app.get<Model<PaymentEvent>>(
      getModelToken(PaymentEvent.name),
    );
    expect(await events.countDocuments()).toBe(0);
    await request(app.getHttpServer()).get('/api/health/ready').expect(200);
  });
});
