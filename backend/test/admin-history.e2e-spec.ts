import {
  Global,
  INestApplication,
  Module,
  ServiceUnavailableException,
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
import { Connection, Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import {
  OutboxEvent,
  outboxEvent,
} from '../src/common/events/outbox-event.schema';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { AdministrationModule } from '../src/modules/administration/administration.module';
import {
  ACCOUNT_HISTORY_ACTIONS,
  DOMAIN_HISTORY_ACTIONS,
} from '../src/modules/administration/dto/admin-history.dto';
import { AdminOutboxEvent } from '../src/modules/administration/schemas/admin-outbox.schema';
import { hashPassword } from '../src/modules/auth/security/password';
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

describe('GEN-07 committed administrative history with separate delivery acknowledgment', () => {
  jest.setTimeout(180_000);
  let app: INestApplication;
  let server: MongoMemoryReplSet;
  let connection: Connection;
  let users: Model<User>;
  let accounts: Model<AdminOutboxEvent>;
  let domain: Model<OutboxEvent>;
  let admin: Agent;
  let traveler: Agent;
  let adminId: string;
  let otherAdminId: string;
  let targetId: string;
  let hotelId: string;
  let passwordHash: string;

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
      instanceOpts: [{ launchTimeout: 30_000 }],
    });
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), {
          dbName: 'giu_admin_history',
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
    accounts = app.get(getModelToken(AdminOutboxEvent.name));
    domain = app.get(getModelToken(OutboxEvent.name));
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    passwordHash = await hashPassword('test-password1');
  });
  beforeEach(async () => {
    await Promise.all(
      Object.values(connection.collections).map((collection) =>
        collection.deleteMany({}),
      ),
    );
    const rows = await users.create([
      {
        email: 'admin@example.com',
        fullName: 'Admin',
        roles: ['admin'],
        passwordHash,
      },
      { email: 'owner@example.com', fullName: 'Owner', passwordHash },
      {
        email: 'other-admin@example.com',
        fullName: 'Other Admin',
        roles: ['admin'],
        passwordHash,
      },
    ]);
    [adminId, targetId, otherAdminId] = rows.map((row) => row._id.toString());
    admin = await signIn('admin@example.com');
    traveler = await signIn('owner@example.com');
    hotelId = (
      await admin
        .post('/api/hotels')
        .send({
          name: 'History Hotel',
          address: '1 Street',
          cityId: 'cairo',
          countryCode: 'EG',
          starRating: 4,
        })
        .expect(201)
    ).body.id;
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    await server?.stop();
  });
  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/login')
      .send({ email, password: 'test-password1' })
      .expect(200);
    return agent;
  }
  function accountEvent(
    type: (typeof ACCOUNT_HISTORY_ACTIONS)[number] = 'account.suspended',
    occurredAt = '2026-11-18T12:00:00.000Z',
    actorId = adminId,
  ) {
    const id = randomUUID();
    return {
      id,
      type,
      version: 1,
      occurredAt,
      correlationId: id,
      actorId,
      payload: { targetUserId: targetId },
      status: 'pending',
    };
  }
  function list(query: Record<string, unknown> = {}) {
    return admin.get('/api/admin/audit-logs').query(query);
  }

  it('reads actual committed account and provider actions before delivery', async () => {
    await admin
      .patch(`/api/admin/accounts/${targetId}/suspend`)
      .send({})
      .expect(204);
    await admin
      .patch(`/api/admin/providers/hotel/${hotelId}/deactivate`)
      .send({})
      .expect(204);
    const result = (
      await list().expect(200).expect('Cache-Control', 'no-store')
    ).body;
    expect(result.meta.total).toBe(2);
    expect(
      new Set(result.data.map((row: { action: string }) => row.action)),
    ).toEqual(new Set(['account.suspended', 'hotel.deactivated']));
    expect(result.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'account.suspended',
          actorId: adminId,
          target: { type: 'account', id: targetId },
          outcome: 'committed',
          deliveryStatus: 'pending',
        }),
        expect.objectContaining({
          action: 'hotel.deactivated',
          target: { type: 'hotel', id: hotelId },
          outcome: 'committed',
          deliveryStatus: 'pending',
        }),
      ]),
    );
  });

  it('maps every current admin action, excludes system booking events and retains delivered history', async () => {
    await accounts.create(
      ACCOUNT_HISTORY_ACTIONS.map((type) => accountEvent(type)),
    );
    await domain.create(
      DOMAIN_HISTORY_ACTIONS.map((type) =>
        outboxEvent(
          type,
          adminId,
          type.startsWith('hotel.')
            ? { hotelId }
            : type === 'moderation.report_dismissed'
              ? { reportId: targetId, targetType: 'post', targetId }
              : { targetType: 'itinerary', targetId },
        ),
      ),
    );
    await domain.create(
      outboxEvent('hotel_booking.confirmed', null, { bookingId: targetId }),
    );
    const before = (await list().expect(200)).body;
    expect(before.meta.total).toBe(9);
    expect(
      before.data.find(
        (row: { action: string }) =>
          row.action === 'moderation.report_dismissed',
      ).target,
    ).toEqual({ type: 'report', id: targetId });
    expect(
      before.data.find(
        (row: { action: string }) => row.action === 'moderation.content_hidden',
      ).target,
    ).toEqual({ type: 'itinerary', id: targetId });
    await accounts.updateMany({}, { $set: { status: 'delivered' } });
    await domain.updateMany({}, { $set: { status: 'delivered' } });
    const after = (await list().expect(200)).body;
    expect(after.meta.total).toBe(9);
    expect(
      after.data.every(
        (row: { outcome: string; deliveryStatus: string }) =>
          row.outcome === 'committed' && row.deliveryStatus === 'delivered',
      ),
    ).toBe(true);
  });

  it('paginates both sources together with stable event IDs and correct totals', async () => {
    const ids: string[] = [];
    for (let index = 0; index < 12; index++) {
      if (index % 2) {
        const row = accountEvent();
        ids.push(row.id);
        await accounts.create(row);
      } else {
        const row = {
          ...outboxEvent('hotel.deactivated', adminId, { hotelId }),
          occurredAt: '2026-11-18T12:00:00.000Z',
        };
        ids.push(row.id);
        await domain.create(row);
      }
    }
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
    ).toEqual(ids.sort().reverse());
    expect((await list({ page: 3 }).expect(200)).body.data).toEqual([]);
  });

  it('combines actor/action and inclusive UTC date filters', async () => {
    await accounts.create([
      accountEvent('account.suspended', '2026-11-01T00:00:00.000Z'),
      accountEvent('account.suspended', '2026-11-02T23:59:59.999Z'),
      accountEvent(
        'account.suspended',
        '2026-11-02T12:00:00.000Z',
        otherAdminId,
      ),
      accountEvent('account.reactivated', '2026-11-02T12:00:00.000Z'),
    ]);
    const result = (
      await list({
        actorId: adminId.toUpperCase(),
        action: 'account.suspended',
        from: '2026-11-02',
        to: '2026-11-02',
      }).expect(200)
    ).body;
    expect(result.meta.total).toBe(1);
    expect(result.data[0].occurredAt).toBe('2026-11-02T23:59:59.999Z');
    expect(
      (await list({ from: '2026-11-01', to: '2026-11-02' }).expect(200)).body
        .meta.total,
    ).toBe(4);
  });

  it('projects identifiers only and never changes source records while reading', async () => {
    const row = await domain.create(
      outboxEvent('moderation.content_deleted', adminId, {
        targetType: 'post',
        targetId,
        email: 'controlled-private@example.com',
        passwordHash: 'controlled-private-value',
        rawBody: 'controlled-private-value',
      }),
    );
    const before = await domain.findById(row._id).lean();
    const result = (await list().expect(200)).body;
    expect(Object.keys(result.data[0]).sort()).toEqual(
      [
        'action',
        'actorId',
        'correlationId',
        'deliveryStatus',
        'id',
        'occurredAt',
        'outcome',
        'target',
      ].sort(),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /controlled-private|passwordHash|rawBody|payload/,
    );
    expect(await domain.findById(row._id).lean()).toEqual(before);
  });

  it('does not manufacture history for a rolled-back account action', async () => {
    jest
      .spyOn(accounts, 'create')
      .mockRejectedValueOnce(
        new ServiceUnavailableException('Injected event failure'),
      );
    await admin
      .patch(`/api/admin/accounts/${targetId}/suspend`)
      .send({})
      .expect(503);
    expect((await users.findById(targetId).orFail()).status).toBe('active');
    expect((await list().expect(200)).body.meta.total).toBe(0);
  });

  it('requires an active unrestricted administrator', async () => {
    await request(app.getHttpServer()).get('/api/admin/audit-logs').expect(401);
    await traveler.get('/api/admin/audit-logs').expect(403);
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

  it('rejects malformed/unknown queries and documents filters and safe schema', async () => {
    for (const query of [
      { actorId: 'invalid' },
      { action: 'hotel_booking.confirmed' },
      { page: 0 },
      { page: 1.2 },
      { page: Number.MAX_SAFE_INTEGER },
      { limit: 20 },
      { from: '2026-02-30' },
      { to: 'invalid' },
      { from: '2026-11-03', to: '2026-11-01' },
      { 'actorId[$ne]': 'invalid' },
    ])
      await list(query).expect(400);
    expect((await list().expect(200)).body.meta).toEqual({
      page: 1,
      limit: 10,
      total: 0,
      totalPages: 0,
    });
    const doc = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    const operation = doc.paths['/api/admin/audit-logs'].get;
    expect(
      operation.parameters.map((entry: { name: string }) => entry.name),
    ).toEqual(
      expect.arrayContaining(['actorId', 'action', 'from', 'to', 'page']),
    );
    expect(operation.security).toBeDefined();
    expect(
      doc.components.schemas.AdminHistoryViewDto.properties,
    ).not.toHaveProperty('payload');
  });
});
