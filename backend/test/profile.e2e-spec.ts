import { Global, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import request from 'supertest';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { AuthModule } from '../src/modules/auth/auth.module';
import { hashPassword } from '../src/modules/auth/security/password';
import { User, USER_ROLES } from '../src/modules/users/schemas/user.schema';
import { UserSession } from '../src/modules/auth/schemas/user-session.schema';
import { CURRENCIES } from '../src/modules/itineraries/reference-data';

@Global()
@Module({
  providers: [{ provide: ConfigService, useValue: new ConfigService({ NODE_ENV: 'test' }) }],
  exports: [ConfigService],
})
class TestConfigurationModule {}

// Real production modules and disposable MongoDB. Never loads AppModule/.env.
describe('Own profile (real HTTP and MongoDB)', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryServer;
  let app: INestApplication;
  let users: Model<User>;
  let sessions: Model<UserSession>;
  let passwordHash: string;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    const module = await Test.createTestingModule({
      imports: [TestConfigurationModule, MongooseModule.forRoot(server.getUri(), { dbName: 'giu_profile_tests' }), AuthModule],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpErrorFilter());
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Test API').build()));
    await app.init();
    users = app.get(getModelToken(User.name));
    sessions = app.get(getModelToken(UserSession.name));
    await Promise.all([users.init(), sessions.init()]);
    passwordHash = await hashPassword('test-password1');
  });

  beforeEach(async () => {
    await Promise.all([users.deleteMany({}), sessions.deleteMany({})]);
    await users.create({ email: 'owner@example.com', fullName: 'Original Name', passwordHash });
  });

  afterAll(async () => {
    await app?.close();
    await server?.stop();
  });

  async function signIn() {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email: 'owner@example.com', password: 'test-password1' }).expect(200);
    return agent;
  }

  it('rejects unauthenticated reads and writes', async () => {
    await request(app.getHttpServer()).get('/api/users/me').expect(401);
    await request(app.getHttpServer()).patch('/api/users/me').send({ preferredCurrency: 'EGP' }).expect(401);
  });

  it.each(USER_ROLES)('lets a %s edit all three fields and read them through identity/refresh', async (role) => {
    await users.updateOne({ email: 'owner@example.com' }, { $set: { roles: [role] } });
    const agent = await signIn();
    const response = await agent.patch('/api/users/me').send({ fullName: '  Updated Name  ', phone: ' +201001234567 ', preferredCurrency: ' egp ' }).expect(200);
    const expected = { fullName: 'Updated Name', phone: '+201001234567', preferredCurrency: 'EGP', roles: [role] };
    expect(response.body).toMatchObject(expected);
    expect(response.headers['cache-control']).toBe('no-store');
    expect(Object.keys(response.body).sort()).toEqual(['email', 'fullName', 'id', 'mustChangePassword', 'phone', 'preferredCurrency', 'roles', 'status']);
    expect((await agent.get('/api/users/me').expect(200)).body).toMatchObject(expected);
    expect((await agent.get('/api/auth/me').expect(200)).body).toMatchObject(expected);
    expect((await agent.post('/api/auth/refresh').expect(200)).body.user).toMatchObject(expected);
    expect(await users.findOne({ email: 'owner@example.com' }).lean()).toMatchObject(expected);
  });

  it.each(CURRENCIES)('accepts the official supported currency %s', async (preferredCurrency) => {
    const agent = await signIn();
    const response = await agent.patch('/api/users/me').send({ preferredCurrency }).expect(200);
    expect(response.body.preferredCurrency).toBe(preferredCurrency);
  });

  it('preserves omitted fields, supports empty patches and clears an optional phone explicitly', async () => {
    const agent = await signIn();
    await agent.patch('/api/users/me').send({ phone: '+201001234567', preferredCurrency: 'EUR' }).expect(200);
    const nameOnly = await agent.patch('/api/users/me').send({ fullName: 'New Name' }).expect(200);
    expect(nameOnly.body).toMatchObject({ phone: '+201001234567', preferredCurrency: 'EUR' });
    const empty = await agent.patch('/api/users/me').send({}).expect(200);
    expect(empty.body).toEqual(nameOnly.body);
    const cleared = await agent.patch('/api/users/me').send({ phone: null }).expect(200);
    expect(cleared.body).toMatchObject({ fullName: 'New Name', phone: null, preferredCurrency: 'EUR' });
  });

  it.each([
    { phone: 'invalid' }, { phone: '' }, { phone: '01001234567' }, { phone: 201001234567 },
    { phone: { $ne: null } }, { phone: ['+201001234567'] },
    { preferredCurrency: 'BTC' }, { preferredCurrency: 'XYZ' }, { preferredCurrency: null },
    { preferredCurrency: { $ne: null } }, { preferredCurrency: ['EUR'] },
    { fullName: null }, { fullName: ' ' }, { fullName: 42 },
    { roles: ['admin'] }, { status: 'suspended' }, { email: 'other@example.com' },
    { id: '507f1f77bcf86cd799439011' }, { sessionVersion: 99 },
  ])('rejects an invalid field atomically with no partial name change (%j)', async (invalid) => {
    const agent = await signIn();
    await agent.patch('/api/users/me').send({ fullName: 'Should Not Save', ...invalid }).expect(400);
    const stored = await users.findOne({ email: 'owner@example.com' }).orFail();
    expect(stored.fullName).toBe('Original Name');
    expect(stored.phone).toBeNull();
    expect(stored.preferredCurrency).toBeNull();
    expect(stored.roles).toEqual(['traveler']);
    expect(stored.status).toBe('active');
  });

  it('reads and updates legacy accounts without inventing a phone or currency', async () => {
    await users.collection.updateOne({ email: 'owner@example.com' }, { $unset: { phone: '', preferredCurrency: '' } });
    const agent = await signIn();
    const before = await agent.get('/api/users/me').expect(200);
    expect(before.body).toMatchObject({ phone: null, preferredCurrency: null });
    const changed = await agent.patch('/api/users/me').send({ preferredCurrency: 'JPY' }).expect(200);
    expect(changed.body).toMatchObject({ phone: null, preferredCurrency: 'JPY' });
  });

  it('updates only the authenticated account', async () => {
    await users.create({ email: 'other@example.com', fullName: 'Other User', passwordHash, preferredCurrency: 'USD' });
    const agent = await signIn();
    await agent.patch('/api/users/me').send({ preferredCurrency: 'JPY' }).expect(200);
    expect((await users.findOne({ email: 'other@example.com' }).orFail()).preferredCurrency).toBe('USD');
  });

  it.each(['suspended', 'deactivated'])('denies existing sessions after the account becomes %s', async (status) => {
    const agent = await signIn();
    await users.updateOne({ email: 'owner@example.com' }, { $set: { status } });
    await agent.get('/api/users/me').expect(401);
    await agent.patch('/api/users/me').send({ preferredCurrency: 'EUR' }).expect(401);
    expect((await users.findOne({ email: 'owner@example.com' }).orFail()).preferredCurrency).toBeNull();
  });

  it('keeps forced-password-change accounts restricted', async () => {
    await users.updateOne({ email: 'owner@example.com' }, { $set: { mustChangePassword: true } });
    const agent = await signIn();
    await agent.get('/api/users/me').expect(403);
    await agent.patch('/api/users/me').send({ preferredCurrency: 'EUR' }).expect(403);
  });

  it('preserves concurrent edits to different profile fields', async () => {
    const agent = await signIn();
    await Promise.all([
      agent.patch('/api/users/me').send({ fullName: 'Concurrent Name' }).expect(200),
      agent.patch('/api/users/me').send({ preferredCurrency: 'SAR' }).expect(200),
    ]);
    expect((await agent.get('/api/users/me').expect(200)).body).toMatchObject({ fullName: 'Concurrent Name', preferredCurrency: 'SAR' });
  });

  it('documents profile inputs, supported currencies and sanitized outputs in Swagger', async () => {
    const document = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    const operation = document.body.paths['/api/users/me'].patch;
    expect(Object.keys(operation.responses)).toEqual(expect.arrayContaining(['200', '400', '401', '403', '404']));
    const schemas = document.body.components.schemas;
    expect(schemas.UpdateProfileDto.properties.preferredCurrency.enum).toEqual(CURRENCIES);
    expect(schemas.UpdateProfileDto.properties.phone.nullable).toBe(true);
    expect(schemas.AuthUserDto.properties).toHaveProperty('phone');
    expect(schemas.AuthUserDto.properties).toHaveProperty('preferredCurrency');
    expect(schemas.AuthUserDto.properties).not.toHaveProperty('passwordHash');
  });
});
