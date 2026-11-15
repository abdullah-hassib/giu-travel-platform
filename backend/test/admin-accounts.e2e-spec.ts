import { Global, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import request from 'supertest';
import { AdministrationModule } from '../src/modules/administration/administration.module';
import { User } from '../src/modules/users/schemas/user.schema';
import { UserSession } from '../src/modules/auth/schemas/user-session.schema';
import { hashPassword } from '../src/modules/auth/security/password';

// Production feature modules, real guards and a disposable database; no AppModule/.env.
@Global()
@Module({
  providers: [{ provide: ConfigService, useValue: new ConfigService({ NODE_ENV: 'test' }) }],
  exports: [ConfigService],
})
class TestConfigurationModule {}

describe('Administration account list (real HTTP and MongoDB)', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryServer;
  let app: INestApplication;
  let users: Model<User>;
  let sessions: Model<UserSession>;
  let passwordHash: string;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
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
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Test API').build()));
    await app.init();
    users = app.get(getModelToken(User.name));
    sessions = app.get(getModelToken(UserSession.name));
    await Promise.all([users.init(), sessions.init()]);
    passwordHash = await hashPassword('test-password1');
  });

  beforeEach(async () => {
    await Promise.all([users.deleteMany({}), sessions.deleteMany({})]);
    await users.create({ email: 'admin@example.com', fullName: 'Platform Admin', roles: ['admin'], passwordHash });
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
});
