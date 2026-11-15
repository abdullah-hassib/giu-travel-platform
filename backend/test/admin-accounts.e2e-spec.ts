import { Global, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Model } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import request from 'supertest';
import { AdministrationModule } from '../src/modules/administration/administration.module';
import { User } from '../src/modules/users/schemas/user.schema';
import { UserSession } from '../src/modules/auth/schemas/user-session.schema';
import { hashPassword } from '../src/modules/auth/security/password';
import { AdminOutboxEvent } from '../src/modules/administration/schemas/admin-outbox.schema';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';

// Production feature modules, real guards and a disposable database; no AppModule/.env.
@Global()
@Module({
  providers: [{ provide: ConfigService, useValue: new ConfigService({ NODE_ENV: 'test' }) }],
  exports: [ConfigService],
})
class TestConfigurationModule {}

describe('Administration account list (real HTTP and MongoDB)', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryReplSet;
  let app: INestApplication;
  let users: Model<User>;
  let sessions: Model<UserSession>;
  let passwordHash: string;
  let outbox: Model<AdminOutboxEvent>;

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), { dbName: 'giu_admin_tests' }),
        AdministrationModule,
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpErrorFilter());
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Test API').build()));
    await app.init();
    users = app.get(getModelToken(User.name));
    sessions = app.get(getModelToken(UserSession.name));
    outbox = app.get(getModelToken(AdminOutboxEvent.name));
    await Promise.all([users.init(), sessions.init(), outbox.init()]);
    passwordHash = await hashPassword('test-password1');
  });

  beforeEach(async () => {
    await Promise.all([users.deleteMany({}), sessions.deleteMany({}), outbox.deleteMany({})]);
    await users.create({ email: 'admin@example.com', fullName: 'Platform Admin', roles: ['admin'], passwordHash });
  });

  afterAll(async () => {
    await app?.close();
    await server?.stop();
  });
  afterEach(() => jest.restoreAllMocks());

  async function signIn(email = 'admin@example.com') {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password: 'test-password1' }).expect(200);
    return agent;
  }

  it('rejects guests', async () => {
    await request(app.getHttpServer()).get('/api/admin/accounts').expect(401);
  });

  it.each(['traveler', 'airline_moderator', 'hotel_moderator'])('rejects a %s account', async (role) => {
    await users.create({ email: 'member@example.com', fullName: 'Member', roles: [role], passwordHash });
    const agent = await signIn('member@example.com');
    await agent.get('/api/admin/accounts').expect(403);
  });

  it.each(['suspended', 'deactivated'])('rejects an already signed-in administrator after becoming %s', async (status) => {
    const agent = await signIn();
    await users.updateOne({ email: 'admin@example.com' }, { $set: { status } });
    await agent.get('/api/admin/accounts').expect(401);
  });

  it('paginates ten accounts at a time with a stable order and sanitized fields', async () => {
    await users.insertMany(Array.from({ length: 12 }, (_, index) => ({
      email: `member${index}@example.com`, fullName: `Member ${index}`, passwordHash,
      createdAt: new Date('2026-11-01T12:00:00Z'),
    })));
    const agent = await signIn();
    const first = await agent.get('/api/admin/accounts').expect(200);
    const second = await agent.get('/api/admin/accounts?page=2').expect(200);
    const repeat = await agent.get('/api/admin/accounts').expect(200);
    expect(first.body.meta).toEqual({ page: 1, limit: 10, total: 13, totalPages: 2 });
    expect(second.body.meta).toEqual({ page: 2, limit: 10, total: 13, totalPages: 2 });
    expect(first.body.data).toHaveLength(10);
    expect(second.body.data).toHaveLength(3);
    expect(repeat.body.data).toEqual(first.body.data);
    const all = [...first.body.data, ...second.body.data];
    expect(new Set(all.map((row) => row.id)).size).toBe(13);
    expect(first.body.data[0].email).toBe('admin@example.com');
    for (const row of all) {
      expect(Object.keys(row).sort()).toEqual(['createdAt', 'email', 'fullName', 'id', 'roles', 'status']);
      expect(Number.isNaN(Date.parse(row.createdAt))).toBe(false);
    }
    expect(first.headers['cache-control']).toBe('no-store');
  });

  it('combines literal name/email search with role and status filters', async () => {
    await users.create([
      { email: 'hotel@example.com', fullName: 'Hotel Moderator', passwordHash, roles: ['hotel_moderator'], status: 'suspended' },
      { email: 'hotel-other@example.com', fullName: 'Hotel Other', passwordHash, roles: ['hotel_moderator'] },
    ]);
    const agent = await signIn();
    const response = await agent.get('/api/admin/accounts').query({ search: ' HOTEL ', role: 'hotel_moderator', status: 'suspended' }).expect(200);
    expect(response.body.meta.total).toBe(1);
    expect(response.body.data[0].email).toBe('hotel@example.com');
    const email = await agent.get('/api/admin/accounts').query({ search: 'ADMIN@EXAMPLE' }).expect(200);
    expect(email.body.meta.total).toBe(1);
    expect(email.body.data[0].fullName).toBe('Platform Admin');
  });

  it('treats regex metacharacters as literal text', async () => {
    await users.create({ email: 'literal@example.com', fullName: 'Literal .* Person', passwordHash });
    const agent = await signIn();
    const response = await agent.get('/api/admin/accounts').query({ search: '.*' }).expect(200);
    expect(response.body.meta.total).toBe(1);
    expect(response.body.data[0].email).toBe('literal@example.com');
  });

  it('returns truthful metadata for no matches and pages past the end', async () => {
    const agent = await signIn();
    const empty = await agent.get('/api/admin/accounts').query({ search: 'no-such-account' }).expect(200);
    expect(empty.body).toEqual({ data: [], meta: { page: 1, limit: 10, total: 0, totalPages: 0 } });
    const past = await agent.get('/api/admin/accounts?page=2').expect(200);
    expect(past.body).toEqual({ data: [], meta: { page: 2, limit: 10, total: 1, totalPages: 1 } });
  });

  it.each([
    'page=0', 'page=1.5', 'page=oops', 'page=9007199254740991',
    'role=provider', 'status=deleted', 'search[$ne]=x', 'role[$ne]=admin',
    'limit=100', 'sortBy=passwordHash',
  ])('rejects invalid or unsupported query %s', async (query) => {
    const agent = await signIn();
    await agent.get(`/api/admin/accounts?${query}`).expect(400);
  });

  it('reports unknown legacy registration timestamps as null', async () => {
    await users.collection.insertOne({ email: 'legacy@example.com', fullName: 'Legacy User', passwordHash, roles: ['traveler'], status: 'active' });
    const agent = await signIn();
    const response = await agent.get('/api/admin/accounts?search=legacy@example.com').expect(200);
    expect(response.body.data[0].createdAt).toBeNull();
  });

  it('documents the endpoint and response in generated Swagger', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const operation = response.body.paths['/api/admin/accounts'].get;
    expect(operation.security).toEqual([{ giu_session: [] }]);
    expect(operation.parameters.map((parameter: { name: string }) => parameter.name).sort()).toEqual(['page', 'role', 'search', 'status']);
    expect(operation.responses['200'].content['application/json'].schema.$ref).toContain('AccountsPageDto');
  });

  it.each(['traveler', 'airline_moderator', 'hotel_moderator'])('resets a %s password and enforces the change before other routes', async (role) => {
    const target = await users.create({ email: 'member@example.com', fullName: 'Member', roles: [role], passwordHash });
    const member = await signIn('member@example.com');
    const admin = await signIn();
    const reset = await admin.post(`/api/admin/users/${target._id}/reset-password`).send({ password: 'Temporary123' }).expect(204);
    expect(reset.text).toBe('');
    expect(await sessions.countDocuments({ userId: target._id })).toBe(0);
    await member.get('/api/auth/me').expect(401);
    await member.post('/api/auth/refresh').expect(401);
    await member.post('/api/auth/login').send({ email: target.email, password: 'test-password1' }).expect(401);
    const login = await member.post('/api/auth/login').send({ email: target.email, password: 'Temporary123' }).expect(200);
    expect(login.body.user.mustChangePassword).toBe(true);
    await member.get('/api/auth/me').expect(200);
    await member.get('/api/users/me').expect(403);
    await member.patch('/api/users/me').send({ fullName: 'Changed Name' }).expect(403);
    const refreshed = await member.post('/api/auth/refresh').expect(200);
    expect(refreshed.body.user.mustChangePassword).toBe(true);
    await member.get('/api/users/me').expect(403);
    await member.patch('/api/auth/change-password').send({ currentPassword: 'Temporary123', newPassword: 'Temporary123' }).expect(400);
    await member.patch('/api/auth/change-password').send({ currentPassword: 'Temporary123', newPassword: 'Permanent123' }).expect(204);
    await member.get('/api/auth/me').expect(401);
    await member.post('/api/auth/login').send({ email: target.email, password: 'Temporary123' }).expect(401);
    const permanent = await member.post('/api/auth/login').send({ email: target.email, password: 'Permanent123' }).expect(200);
    expect(permanent.body.user.mustChangePassword).toBe(false);
    await member.get('/api/users/me').expect(200);
    const events = await outbox.find().lean();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'account.password_reset', version: 1, status: 'pending', payload: { targetUserId: target._id.toString() } });
    expect(JSON.stringify(events)).not.toContain('Temporary123');
    expect(JSON.stringify(events)).not.toContain('Permanent123');
    expect(Object.keys(events[0].payload)).toEqual(['targetUserId']);
  });

  it.each(['traveler', 'airline_moderator', 'hotel_moderator'])('prevents a %s from resetting another account', async (role) => {
    await users.create({ email: 'member@example.com', fullName: 'Member', roles: [role], passwordHash });
    const target = await users.create({ email: 'target@example.com', fullName: 'Target', passwordHash });
    const member = await signIn('member@example.com');
    await member.post(`/api/admin/users/${target._id}/reset-password`).send({ password: 'Temporary123' }).expect(403);
    expect(await outbox.countDocuments()).toBe(0);
  });

  it('rejects unauthenticated resets, administrator targets and nonexistent targets', async () => {
    const adminUser = await users.findOne({ email: 'admin@example.com' }).orFail();
    await request(app.getHttpServer()).post(`/api/admin/users/${adminUser._id}/reset-password`).send({ password: 'Temporary123' }).expect(401);
    const admin = await signIn();
    await admin.post(`/api/admin/users/${adminUser._id}/reset-password`).send({ password: 'Temporary123' }).expect(403);
    await admin.post('/api/admin/users/000000000000000000000000/reset-password').send({ password: 'Temporary123' }).expect(404);
    await admin.post('/api/admin/users/not-an-id/reset-password').send({ password: 'Temporary123' }).expect(400);
    expect(await outbox.countDocuments()).toBe(0);
  });

  it.each(['abcdefgh', '12345678', 'short1'])('rejects a noncompliant temporary password %s', async (password) => {
    const target = await users.create({ email: 'member@example.com', fullName: 'Member', passwordHash });
    const admin = await signIn();
    await admin.post(`/api/admin/users/${target._id}/reset-password`).send({ password }).expect(400);
    expect(await outbox.countDocuments()).toBe(0);
  });

  it.each(['suspended', 'deactivated'])('preserves %s status during a reset', async (status) => {
    const target = await users.create({ email: 'member@example.com', fullName: 'Member', passwordHash, status });
    const admin = await signIn();
    await admin.post(`/api/admin/users/${target._id}/reset-password`).send({ password: 'Temporary123' }).expect(204);
    expect((await users.findById(target._id).orFail()).status).toBe(status);
    await request(app.getHttpServer()).post('/api/auth/login').send({ email: target.email, password: 'Temporary123' }).expect(401);
  });

  it('rolls back the password and session changes if the outbox write fails', async () => {
    const target = await users.create({ email: 'member@example.com', fullName: 'Member', passwordHash });
    const member = await signIn('member@example.com');
    const admin = await signIn();
    jest.spyOn(outbox, 'create').mockRejectedValueOnce(new Error('outbox unavailable'));
    const response = await admin.post(`/api/admin/users/${target._id}/reset-password`).send({ password: 'Temporary123' }).expect(500);
    expect(response.body.message).toBe('Internal server error');
    const unchanged = await users.findById(target._id).select('+passwordHash').orFail();
    expect(unchanged.passwordHash).toBe(passwordHash);
    expect(unchanged.mustChangePassword).toBe(false);
    expect(unchanged.sessionVersion).toBe(0);
    await member.get('/api/users/me').expect(200);
    expect(await outbox.countDocuments()).toBe(0);
  });
});
