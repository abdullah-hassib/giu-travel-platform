import { Global, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { hashPassword } from '../src/modules/auth/security/password';
import { User } from '../src/modules/users/schemas/user.schema';
import { AuditLog } from '../src/modules/audit-logging/schemas/audit-log.schema';
import { AuditLoggingService } from '../src/modules/audit-logging/audit-logging.service';
import { AuditLoggingModule } from '../src/modules/audit-logging/audit-logging.module';
import { AdministrationModule } from '../src/modules/administration/administration.module';
import { AdminOutboxEvent } from '../src/modules/administration/schemas/admin-outbox.schema';
import { AdminOutboxConsumer } from '../src/modules/audit-logging/admin-outbox-consumer';

@Global()
@Module({
  providers: [{ provide: ConfigService, useValue: new ConfigService({ NODE_ENV: 'test' }) }],
  exports: [ConfigService],
})
class TestConfigurationModule {}

describe('Administrative audit logs API (real HTTP and MongoDB)', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryReplSet;
  let app: INestApplication;
  let users: Model<User>;
  let auditLogs: Model<AuditLog>;
  let outbox: Model<AdminOutboxEvent>;
  let auditLogging: AuditLoggingService;
  let outboxConsumer: AdminOutboxConsumer;
  let passwordHash: string;

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      instanceOpts: [{ launchTimeout: 30_000 }],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), { dbName: 'giu_audit_tests' }),
        AdministrationModule,
        AuditLoggingModule,
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpErrorFilter());
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Test API').build()));
    await app.init();
    users = app.get(getModelToken(User.name));
    auditLogs = app.get(getModelToken(AuditLog.name));
    outbox = app.get(getModelToken(AdminOutboxEvent.name));
    auditLogging = app.get(AuditLoggingService);
    outboxConsumer = app.get(AdminOutboxConsumer);
    await Promise.all([users.init(), auditLogs.init(), outbox.init()]);
    passwordHash = await hashPassword('test-password1');
  });

  beforeEach(async () => {
    await Promise.all([users.deleteMany({}), auditLogs.deleteMany({}), outbox.deleteMany({})]);
    await users.create([
      { email: 'admin@example.com', fullName: 'Platform Admin', passwordHash, roles: ['admin'] },
      { email: 'traveler@example.com', fullName: 'Traveler', passwordHash, roles: ['traveler'] },
      { email: 'airline-mod@example.com', fullName: 'Airline Moderator', passwordHash, roles: ['airline_moderator'] },
      { email: 'hotel-mod@example.com', fullName: 'Hotel Moderator', passwordHash, roles: ['hotel_moderator'] },
    ]);
  });

  afterAll(async () => {
    await app?.close();
    await server?.stop();
  });

  async function signIn(email = 'admin@example.com') {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password: 'test-password1' }).expect(200);
    return agent;
  }

  async function append(eventId: string, overrides: Partial<Parameters<AuditLoggingService['append']>[0]> = {}) {
    return auditLogging.append({
      eventId,
      actorId: '507f1f77bcf86cd799439011',
      action: 'account.suspended',
      resourceType: 'account',
      resourceId: '507f1f77bcf86cd799439012',
      occurredAt: new Date('2026-11-17T12:00:00.000Z'),
      correlationId: `correlation-${eventId}`,
      outcome: 'success',
      ...overrides,
    });
  }

  it('requires authentication and denies travelers and moderators', async () => {
    await request(app.getHttpServer()).get('/api/admin/audit-logs').expect(401);
    for (const email of ['traveler@example.com', 'airline-mod@example.com', 'hotel-mod@example.com']) {
      const agent = await signIn(email);
      await agent.get('/api/admin/audit-logs').expect(403);
    }
  });

  it('lists audit records with shared pagination and default newest-first order', async () => {
    await append('evt-old', { occurredAt: new Date('2026-11-16T12:00:00.000Z') });
    await append('evt-new', { occurredAt: new Date('2026-11-17T12:00:00.000Z') });
    const agent = await signIn();
    const response = await agent.get('/api/admin/audit-logs').expect(200);
    expect(response.body.meta).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
    expect(response.body.data.map((row: { eventId: string }) => row.eventId)).toEqual(['evt-new', 'evt-old']);
    expect(response.headers['cache-control']).toBe('no-store');
  });

  it('supports explicit filters and date ranges', async () => {
    await append('evt-one', { action: 'provider.deactivated', resourceType: 'provider', resourceId: 'hotel-1', actorId: '507f1f77bcf86cd799439013', occurredAt: new Date('2026-11-16T12:00:00.000Z') });
    await append('evt-two', { action: 'account.suspended', resourceType: 'account', resourceId: '507f1f77bcf86cd799439014', occurredAt: new Date('2026-11-17T12:00:00.000Z'), outcome: 'failure' });
    const agent = await signIn();
    const response = await agent.get('/api/admin/audit-logs').query({
      action: 'provider.deactivated', resourceType: 'provider', resourceId: 'hotel-1',
      actorId: '507f1f77bcf86cd799439013', outcome: 'success',
      from: '2026-11-16T00:00:00.000Z', to: '2026-11-16T23:59:59.999Z',
    }).expect(200);
    expect(response.body.meta.total).toBe(1);
    expect(response.body.data[0].eventId).toBe('evt-one');
  });

  it.each([
    'page=0', 'limit=101', 'sortBy=metadata', 'outcome=unknown',
    'actorId=not-an-object-id', 'from=not-a-date', 'search[$ne]=x',
  ])('rejects malformed and unsupported query %s', async (query) => {
    const agent = await signIn();
    await agent.get(`/api/admin/audit-logs?${query}`).expect(400);
  });

  it('rejects a reversed date range', async () => {
    const agent = await signIn();
    await agent.get('/api/admin/audit-logs?from=2026-11-18T00:00:00.000Z&to=2026-11-17T00:00:00.000Z').expect(400);
  });

  it('deduplicates event redelivery and excludes sensitive metadata', async () => {
    const first = await append('evt-duplicate', {
      metadata: { status: 'suspended', password: 'must-not-store', email: 'private@example.com', count: 2 },
    });
    const duplicate = await append('evt-duplicate', { action: 'different.action' });
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.action).toBe(first.action);
    expect(first.metadata).toEqual({ status: 'suspended', count: 2 });
    expect(await auditLogs.countDocuments({ eventId: 'evt-duplicate' })).toBe(1);
  });

  it('deduplicates concurrent audit appends for the same event', async () => {
    const input = {
      eventId: 'evt-concurrent',
      actorId: '507f1f77bcf86cd799439011',
      action: 'provider.deactivated',
      resourceType: 'provider',
      resourceId: 'hotel-1',
      occurredAt: new Date('2026-11-17T12:00:00.000Z'),
      outcome: 'success' as const,
    };
    const [first, second] = await Promise.all([auditLogging.append(input), auditLogging.append(input)]);
    expect(second.id).toBe(first.id);
    expect(await auditLogs.countDocuments({ eventId: input.eventId })).toBe(1);
  });

  it('consumes the real admin password-reset outbox transactionally into one audit record', async () => {
    const target = await users.findOne({ email: 'traveler@example.com' }).orFail();
    const agent = await signIn();
    await agent.post(`/api/admin/users/${target._id.toString()}/reset-password`).send({ password: 'temporary1' }).expect(204);
    const pending = await outbox.findOne({ type: 'account.password_reset' }).orFail();
    expect(pending.status).toBe('pending');

    expect(await outboxConsumer.consumePending()).toBe(1);
    expect(await outboxConsumer.consumePending()).toBe(0);
    expect((await outbox.findById(pending._id).orFail()).status).toBe('delivered');
    const record = await auditLogs.findOne({ eventId: pending.id }).orFail();
    expect(record).toMatchObject({
      actorId: pending.actorId,
      action: 'account.password_reset',
      resourceType: 'account',
      resourceId: target._id.toString(),
      outcome: 'success',
    });

    const response = await agent.get('/api/admin/audit-logs?action=account.password_reset').expect(200);
    expect(response.body.meta.total).toBe(1);
    expect(response.body.data[0].eventId).toBe(pending.id);
  });

  it('leaves an outbox event pending when audit persistence fails, then retries it', async () => {
    const target = await users.findOne({ email: 'traveler@example.com' }).orFail();
    const agent = await signIn();
    await agent.post(`/api/admin/users/${target._id.toString()}/reset-password`).send({ password: 'temporary1' }).expect(204);
    const pending = await outbox.findOne({ type: 'account.password_reset' }).orFail();
    const appendSpy = jest.spyOn(auditLogging, 'append').mockRejectedValueOnce(new Error('simulated audit store failure'));

    await expect(outboxConsumer.consumePending()).rejects.toThrow('simulated audit store failure');
    expect((await outbox.findById(pending._id).orFail()).status).toBe('pending');
    expect(await auditLogs.countDocuments({ eventId: pending.id })).toBe(0);

    appendSpy.mockRestore();
    expect(await outboxConsumer.consumePending()).toBe(1);
    expect((await outbox.findById(pending._id).orFail()).status).toBe('delivered');
    expect(await auditLogs.countDocuments({ eventId: pending.id })).toBe(1);
  });

  it('documents the endpoint and filters in Swagger', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const operation = response.body.paths['/api/admin/audit-logs'].get;
    expect(operation).toBeDefined();
    expect(operation.parameters.map((parameter: { name: string }) => parameter.name)).toEqual(expect.arrayContaining([
      'page', 'limit', 'sortBy', 'order', 'actorId', 'action', 'resourceType', 'resourceId', 'outcome', 'from', 'to',
    ]));
  });
});
