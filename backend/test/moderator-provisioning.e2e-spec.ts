import {
  Global,
  INestApplication,
  Module,
  NotFoundException,
  ValidationPipe,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Model, Schema, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import request from 'supertest';
import { AdministrationModule } from '../src/modules/administration/administration.module';
import {
  ADMINISTRATION_PROVIDER_ADAPTERS,
  ProviderAdministrationAdapter,
  ProviderKind,
} from '../src/modules/administration/provider-administration.adapter';
import { ModeratorAssignment } from '../src/modules/administration/schemas/moderator-assignment.schema';
import { ModeratorAssignmentsService } from '../src/modules/administration/moderator-assignments.module';
import { AdminOutboxEvent } from '../src/modules/administration/schemas/admin-outbox.schema';
import { User } from '../src/modules/users/schemas/user.schema';
import { UserSession } from '../src/modules/auth/schemas/user-session.schema';
import {
  hashPassword,
  verifyPassword,
} from '../src/modules/auth/security/password';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';

const FIXTURE = 'ModeratorProviderFixture';
interface ProviderFixture {
  _id: Types.ObjectId;
  kind: ProviderKind;
  fence: number;
}
const fixtureSchema = new Schema<ProviderFixture>({
  kind: String,
  fence: { type: Number, default: 0 },
});
@Global()
@Module({
  imports: [
    MongooseModule.forFeature([{ name: FIXTURE, schema: fixtureSchema }]),
  ],
  providers: [
    {
      provide: ConfigService,
      useValue: new ConfigService({ NODE_ENV: 'test' }),
    },
  ],
  exports: [MongooseModule, ConfigService],
})
class TestDependencies {}

// No .env, AppModule or actual provider implementations. The fixture's writes
// share the real transaction used by the production administration service.
describe('ACC-13 moderator provisioning (real HTTP/replica set, provider fixtures)', () => {
  jest.setTimeout(180000);
  let server: MongoMemoryReplSet;
  let app: INestApplication;
  let users: Model<User>;
  let sessions: Model<UserSession>;
  let assignments: Model<ModeratorAssignment>;
  let outbox: Model<AdminOutboxEvent>;
  let providers: Model<ProviderFixture>;
  let passwordHash: string;
  const adapters: ProviderAdministrationAdapter[] = [];
  const lock = jest.fn<
    ReturnType<ProviderAdministrationAdapter['lockExisting']>,
    Parameters<ProviderAdministrationAdapter['lockExisting']>
  >();

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const module = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(server.getUri(), {
          dbName: 'giu_moderator_tests',
        }),
        TestDependencies,
        AdministrationModule,
      ],
    })
      .overrideProvider(ADMINISTRATION_PROVIDER_ADAPTERS)
      .useValue(adapters)
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
    assignments = app.get(getModelToken(ModeratorAssignment.name));
    outbox = app.get(getModelToken(AdminOutboxEvent.name));
    providers = app.get(getModelToken(FIXTURE));
    await Promise.all([
      users.init(),
      sessions.init(),
      assignments.init(),
      outbox.init(),
      providers.init(),
    ]);
    passwordHash = await hashPassword('test-password1');
  });
  beforeEach(async () => {
    await Promise.all([
      users.deleteMany({}),
      sessions.deleteMany({}),
      assignments.deleteMany({}),
      outbox.deleteMany({}),
      providers.deleteMany({}),
    ]);
    await users.create({
      email: 'admin@example.com',
      fullName: 'Admin',
      roles: ['admin'],
      passwordHash,
    });
    lock.mockReset().mockImplementation(async (id, session) => {
      const provider = await providers
        .findOneAndUpdate(
          { _id: id },
          { $inc: { fence: 1 } },
          { session, new: true },
        )
        .lean()
        .exec();
      if (!provider) throw new NotFoundException('Provider not found');
      return { id: provider._id.toString(), kind: provider.kind };
    });
    adapters.splice(
      0,
      adapters.length,
      ...(['airline', 'hotel'] as const).map((kind) => ({
        kind,
        lockExisting: lock,
      })),
    );
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    await server?.stop();
  });

  async function signIn(
    email = 'admin@example.com',
    password = 'test-password1',
  ) {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password }).expect(200);
    return agent;
  }
  async function payload(kind: ProviderKind = 'hotel') {
    const provider = await providers.create({ kind });
    return {
      fullName: ' New Moderator ',
      email: ' MODERATOR@EXAMPLE.COM ',
      password: 'temporary-password1',
      role: kind === 'hotel' ? 'hotel_moderator' : 'airline_moderator',
      providerId: provider._id.toString().toUpperCase(),
    };
  }

  it.each(['airline', 'hotel'] as const)(
    'creates a %s moderator, one assignment and a private pending event atomically',
    async (kind) => {
      const agent = await signIn();
      const dto = await payload(kind);
      const result = await agent
        .post('/api/admin/moderators')
        .send(dto)
        .expect(201);
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.body).toEqual({
        id: expect.any(String),
        fullName: 'New Moderator',
        email: 'moderator@example.com',
        role: dto.role,
        providerType: kind,
        providerId: dto.providerId.toLowerCase(),
        mustChangePassword: true,
      });
      const user = await users
        .findById(result.body.id)
        .select('+passwordHash')
        .orFail();
      expect(user.roles).toEqual([dto.role]);
      expect(user.mustChangePassword).toBe(true);
      expect(user.termsAcceptedAt).toBeUndefined();
      expect(user.passwordHash).not.toBe(dto.password);
      expect(await verifyPassword(dto.password, user.passwordHash)).toBe(true);
      const assignment = await assignments.findOne().orFail();
      expect(assignment.userId.toString()).toBe(result.body.id);
      expect(
        await app
          .get(ModeratorAssignmentsService)
          .getForModerator(result.body.id),
      ).toEqual({
        providerType: kind,
        providerId: dto.providerId.toLowerCase(),
      });
      const event = await outbox.findOne().orFail().lean();
      expect(event.type).toBe('moderator.created');
      expect(event.status).toBe('pending');
      expect(event.payload).toMatchObject({
        targetUserId: result.body.id,
        providerType: kind,
        providerId: dto.providerId.toLowerCase(),
        assignmentId: assignment._id.toString(),
      });
      expect(JSON.stringify(event)).not.toMatch(
        /temporary-password1|scrypt|moderator@example.com|New Moderator/,
      );
      expect(
        (await agent.get('/api/admin/accounts?role=' + dto.role).expect(200))
          .body.meta.total,
      ).toBe(1);
    },
  );

  it('enforces first-login password change using the existing auth/session flow', async () => {
    const admin = await signIn();
    const dto = await payload();
    await admin.post('/api/admin/moderators').send(dto).expect(201);
    const moderator = await signIn('moderator@example.com', dto.password);
    expect(
      (await moderator.get('/api/auth/me').expect(200)).body.mustChangePassword,
    ).toBe(true);
    await moderator.get('/api/users/me').expect(403);
    await moderator.post('/api/admin/moderators').send(dto).expect(403);
    await moderator
      .patch('/api/auth/change-password')
      .send({
        currentPassword: dto.password,
        newPassword: 'replacement-password2',
      })
      .expect(204);
    await moderator.get('/api/auth/me').expect(401);
    const regular = await signIn(
      'moderator@example.com',
      'replacement-password2',
    );
    expect(
      (await regular.get('/api/users/me').expect(200)).body.mustChangePassword,
    ).toBe(false);
    await regular.get('/api/admin/accounts').expect(403);
    expect(await assignments.countDocuments()).toBe(1);
  });

  it('denies unauthenticated creation', async () => {
    await request(app.getHttpServer())
      .post('/api/admin/moderators')
      .send(await payload())
      .expect(401);
    expect(lock).not.toHaveBeenCalled();
  });
  it.each(['traveler', 'airline_moderator', 'hotel_moderator'])(
    'denies a %s actor',
    async (role) => {
      await users.create({
        email: 'actor@example.com',
        fullName: 'Actor',
        roles: [role],
        passwordHash,
      });
      const agent = await signIn('actor@example.com');
      await agent
        .post('/api/admin/moderators')
        .send(await payload())
        .expect(403);
      expect(lock).not.toHaveBeenCalled();
    },
  );
  it.each(['suspended', 'deactivated'])(
    'denies an administrator who became %s',
    async (status) => {
      const agent = await signIn();
      await users.updateOne(
        { email: 'admin@example.com' },
        { $set: { status } },
      );
      await agent
        .post('/api/admin/moderators')
        .send(await payload())
        .expect(401);
    },
  );
  it.each([
    { role: 'admin' },
    { role: 'traveler' },
    { fullName: ' ' },
    { email: 'invalid' },
    { password: 'no-digit-password' },
    { providerId: 'invalid' },
    { providerId: null },
    { providerId: ['507f1f77bcf86cd799439011'] },
    { mustChangePassword: false },
    { roles: ['admin'] },
    { status: 'active' },
    { providerType: 'airline' },
  ])(
    'rejects invalid or injected input %j before provider access',
    async (invalid) => {
      const agent = await signIn();
      await agent
        .post('/api/admin/moderators')
        .send({ ...(await payload()), ...invalid })
        .expect(400);
      expect(lock).not.toHaveBeenCalled();
      expect(await assignments.countDocuments()).toBe(0);
    },
  );
  it('fails closed with no provider integration instead of creating an unlinked moderator', async () => {
    const agent = await signIn();
    adapters.splice(0, adapters.length);
    await agent
      .post('/api/admin/moderators')
      .send(await payload())
      .expect(503);
    expect(await users.countDocuments()).toBe(1);
    expect(await outbox.countDocuments()).toBe(0);
  });
  it('rejects missing and wrong-kind providers without orphan accounts', async () => {
    const agent = await signIn();
    const dto = await payload('airline');
    await agent
      .post('/api/admin/moderators')
      .send({ ...dto, providerId: new Types.ObjectId().toString() })
      .expect(404);
    await agent
      .post('/api/admin/moderators')
      .send({ ...dto, role: 'hotel_moderator' })
      .expect(502);
    expect(await users.countDocuments()).toBe(1);
    expect((await providers.findById(dto.providerId).orFail()).fence).toBe(0);
  });
  it('serializes concurrent normalized-email duplicates into one account/assignment/event', async () => {
    const agent = await signIn();
    const dto = await payload();
    const results = await Promise.all([
      agent.post('/api/admin/moderators').send(dto),
      agent
        .post('/api/admin/moderators')
        .send({ ...dto, email: dto.email.trim().toLowerCase() }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await assignments.countDocuments()).toBe(1);
    expect(await outbox.countDocuments()).toBe(1);
  });
  it('permits multiple moderators for a provider while keeping one assignment per account', async () => {
    const agent = await signIn();
    const dto = await payload();
    await agent.post('/api/admin/moderators').send(dto).expect(201);
    await agent
      .post('/api/admin/moderators')
      .send({ ...dto, email: 'second@example.com' })
      .expect(201);
    expect(await assignments.countDocuments()).toBe(2);
    expect(
      new Set((await assignments.find()).map((a) => a.providerId.toString()))
        .size,
    ).toBe(1);
    const assignment = await assignments.findOne().orFail();
    await expect(
      assignments.create({
        userId: assignment.userId,
        providerType: 'hotel',
        providerId: new Types.ObjectId(),
        assignedBy: assignment.assignedBy,
      }),
    ).rejects.toMatchObject({ code: 11000 });
  });
  it.each(['assignment', 'outbox'])(
    'rolls back provider fence and user creation on %s persistence failure',
    async (failure) => {
      const agent = await signIn();
      const dto = await payload();
      const model = failure === 'assignment' ? assignments : outbox;
      jest.spyOn(model, 'create').mockImplementationOnce(() => {
        throw new Error('Controlled transaction failure');
      });
      await agent.post('/api/admin/moderators').send(dto).expect(500);
      expect(await users.countDocuments()).toBe(1);
      expect(await assignments.countDocuments()).toBe(0);
      expect(await outbox.countDocuments()).toBe(0);
      expect((await providers.findById(dto.providerId).orFail()).fence).toBe(0);
    },
  );
  it('keeps existing accounts unchanged when their email is reused', async () => {
    const agent = await signIn();
    await agent
      .post('/api/admin/moderators')
      .send({ ...(await payload()), email: 'ADMIN@example.com' })
      .expect(409);
    expect((await users.findOne().orFail()).roles).toEqual(['admin']);
    expect(await assignments.countDocuments()).toBe(0);
  });
  it('documents validated creation and excludes passwords from the response schema', async () => {
    const document = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    expect(
      document.paths['/api/admin/moderators'].post.responses['201'],
    ).toBeDefined();
    expect(
      document.paths['/api/admin/moderators'].post.responses['503'],
    ).toBeDefined();
    expect(
      document.components.schemas.ModeratorCreatedDto.properties.password,
    ).toBeUndefined();
    expect(
      document.components.schemas.CreateModeratorDto.properties.password
        .writeOnly,
    ).toBe(true);
    expect(
      await app.get(ModeratorAssignmentsService).getForModerator('invalid'),
    ).toBeNull();
  });
});
