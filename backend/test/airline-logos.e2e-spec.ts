import {
  Global,
  INestApplication,
  Module,
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
import { Connection, Model, Types } from 'mongoose';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import request from 'supertest';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { ModeratorAssignment } from '../src/modules/administration/schemas/moderator-assignment.schema';
import { AirlinesModule } from '../src/modules/airlines/airlines.module';
import { Airline } from '../src/modules/airlines/schemas/airline.schema';
import { hashPassword } from '../src/modules/auth/security/password';
import { DomainEventPublisherService } from '../src/modules/domain-events/domain-event-publisher.service';
import { DomainEventOutbox } from '../src/modules/domain-events/schemas/domain-event-outbox.schema';
import { MAX_IMAGE_BYTES } from '../src/modules/media-uploads/media.service';
import { User } from '../src/modules/users/schemas/user.schema';

const uploadDir = mkdtempSync(join(tmpdir(), 'giu-airline-logo-'));
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP4UAAAAASUVORK5CYII=',
  'base64',
);
// Synthetic white pixel generated locally; no external image asset.
const JPEG = Buffer.from(
  '/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAn/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AKpgA//Z',
  'base64',
);
@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useValue: new ConfigService({
        NODE_ENV: 'test',
        MEDIA_UPLOAD_DIR: uploadDir,
      }),
    },
  ],
  exports: [ConfigService],
})
class TestConfigurationModule {}
type Agent = ReturnType<typeof request.agent>;

describe('FLT-01/GEN-08 airline logos (actual HTTP, assignments, transactions and server files)', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryReplSet, app: INestApplication, connection: Connection;
  let users: Model<User>,
    airlines: Model<Airline>,
    assignments: Model<ModeratorAssignment>,
    events: Model<DomainEventOutbox>;
  let admin: Agent,
    mod: Agent,
    otherMod: Agent,
    traveler: Agent,
    hotelMod: Agent;
  let adminId: Types.ObjectId,
    modId: Types.ObjectId,
    airlineId: Types.ObjectId,
    passwordHash: string;
  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      instanceOpts: [{ launchTimeout: 30_000 }],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), {
          dbName: 'giu_airline_logos',
        }),
        AirlinesModule,
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
        new DocumentBuilder()
          .setTitle('Airline logos')
          .addCookieAuth(
            'giu_session',
            { type: 'apiKey', in: 'cookie' },
            'giu_session',
          )
          .build(),
      ),
    );
    await app.init();
    connection = app.get(getConnectionToken());
    users = app.get(getModelToken(User.name));
    airlines = app.get(getModelToken(Airline.name));
    assignments = app.get(getModelToken(ModeratorAssignment.name));
    events = app.get(getModelToken(DomainEventOutbox.name));
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    passwordHash = await hashPassword('logo-password1');
  });
  beforeEach(async () => {
    jest.restoreAllMocks();
    await Promise.all(
      Object.values(connection.collections).map((collection) =>
        collection.deleteMany({}),
      ),
    );
    for (const file of readdirSync(uploadDir))
      unlinkSync(join(uploadDir, file));
    const accounts = await users.create([
      {
        email: 'admin@example.com',
        fullName: 'Admin',
        roles: ['admin'],
        passwordHash,
      },
      {
        email: 'mod@example.com',
        fullName: 'Moderator',
        roles: ['airline_moderator'],
        passwordHash,
      },
      {
        email: 'other-mod@example.com',
        fullName: 'Other Moderator',
        roles: ['airline_moderator'],
        passwordHash,
      },
      { email: 'traveler@example.com', fullName: 'Traveler', passwordHash },
      {
        email: 'hotel@example.com',
        fullName: 'Hotel Moderator',
        roles: ['hotel_moderator'],
        passwordHash,
      },
    ]);
    adminId = accounts[0]._id;
    modId = accounts[1]._id;
    const providers = await airlines.create([
      {
        name: 'Existing Airline',
        code: 'AA',
        logoUrl: 'https://example.com/old.png',
      },
      {
        name: 'Other Airline',
        code: 'BB',
        logoUrl: 'https://example.com/other.png',
      },
    ]);
    airlineId = providers[0]._id;
    await assignments.create([
      {
        userId: modId,
        providerType: 'airline',
        providerId: airlineId,
        assignedBy: adminId,
      },
      {
        userId: accounts[2]._id,
        providerType: 'airline',
        providerId: providers[1]._id,
        assignedBy: adminId,
      },
    ]);
    admin = await login('admin@example.com');
    mod = await login('mod@example.com');
    otherMod = await login('other-mod@example.com');
    traveler = await login('traveler@example.com');
    hotelMod = await login('hotel@example.com');
  });
  afterAll(async () => {
    await app?.close();
    await server?.stop();
    const target = resolve(uploadDir),
      withinTemp = relative(resolve(tmpdir()), target);
    if (
      !withinTemp ||
      withinTemp.startsWith('..') ||
      isAbsolute(withinTemp) ||
      !basename(target).startsWith('giu-airline-logo-')
    )
      throw new Error('Unsafe test cleanup path');
    rmSync(target, { recursive: true, force: true });
  });
  async function login(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/login')
      .send({ email, password: 'logo-password1' })
      .expect(200);
    return agent;
  }
  const url = () => '/api/airlines/' + airlineId + '/logo';
  const upload = (agent = mod) =>
    agent
      .post(url())
      .attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' });
  const imageId = (path: string) => path.slice('/api/media/'.length);

  it('creates an airline with its one multipart logo, sanitized view and real public image URL', async () => {
    const response = await admin
      .post('/api/airlines')
      .field('name', '  Uploaded Airline  ')
      .field('code', ' uu ')
      .attach('file', PNG, 'not-trusted-name.exe')
      .expect(201);
    expect(response.body).toMatchObject({
      name: 'Uploaded Airline',
      code: 'UU',
      status: 'active',
    });
    expect(response.body.logoUrl).toMatch(/^\/api\/media\/[0-9a-f-]+\.png$/);
    expect(response.body).not.toHaveProperty('logoImage');
    expect(response.body).not.toHaveProperty('inventoryVersion');
    expect(readdirSync(uploadDir)).toEqual([imageId(response.body.logoUrl)]);
    const image = await request(app.getHttpServer())
      .get(response.body.logoUrl)
      .expect(200)
      .expect('Content-Type', /^image\/png/);
    expect(image.body).toEqual(PNG);
    const stored = await airlines
      .findById(response.body.id)
      .select('+logoImage')
      .orFail();
    expect(stored.logoImage?.url).toBe(response.body.logoUrl);
    expect(await events.countDocuments({ type: 'airline.created' })).toBe(1);
  });
  it('accepts real JPEG content and chooses its served type from bytes rather than client MIME/name', async () => {
    const response = await mod
      .post(url())
      .attach('file', JPEG, {
        filename: 'untrusted.png',
        contentType: 'image/png',
      })
      .expect(201);
    expect(response.body.logoUrl).toMatch(/\.jpg$/);
    const image = await request(app.getHttpServer())
      .get(response.body.logoUrl)
      .expect(200)
      .expect('Content-Type', /^image\/jpeg/);
    expect(image.body).toEqual(JPEG);
  });
  it('preserves legacy JSON creation while requiring either an uploaded logo or an absolute URL', async () => {
    await admin
      .post('/api/airlines')
      .send({
        name: 'Legacy Airline',
        code: 'CC',
        logoUrl: 'https://example.com/c.png',
      })
      .expect(201);
    await admin
      .post('/api/airlines')
      .send({ name: 'Missing Logo', code: 'DD' })
      .expect(400);
    await admin
      .post('/api/airlines')
      .field('name', 'Both Logos')
      .field('code', 'EE')
      .field('logoUrl', 'https://example.com/e.png')
      .attach('file', PNG, 'logo.png')
      .expect(400);
    await admin
      .post('/api/airlines')
      .send({
        name: 'Borrowed Logo',
        code: 'FF',
        logoUrl: '/api/media/00000000-0000-0000-0000-000000000000.png',
      })
      .expect(400);
    expect(readdirSync(uploadDir)).toEqual([]);
    expect(await airlines.countDocuments()).toBe(3);
  });
  it('replaces the logo for the assigned moderator or administrator and removes only the obsolete owned file', async () => {
    const first = (await upload().expect(201)).body;
    expect(existsSync(join(uploadDir, imageId(first.logoUrl)))).toBe(true);
    const second = (await upload(admin).expect(201)).body;
    expect(second.logoUrl).not.toBe(first.logoUrl);
    expect(readdirSync(uploadDir)).toEqual([imageId(second.logoUrl)]);
    await request(app.getHttpServer()).get(first.logoUrl).expect(404);
    await request(app.getHttpServer()).get(second.logoUrl).expect(200);
    expect(await events.countDocuments({ type: 'airline.updated' })).toBe(2);
  });
  it('checks role, actual assignment and account restrictions before saving a logo', async () => {
    await request(app.getHttpServer())
      .post(url())
      .attach('file', PNG, 'logo.png')
      .expect(401);
    for (const agent of [otherMod, traveler, hotelMod])
      await upload(agent).expect(403);
    await mod
      .post('/api/airlines')
      .field('name', 'Forbidden')
      .field('code', 'ZZ')
      .attach('file', PNG, 'logo.png')
      .expect(403);
    await users.updateOne(
      { _id: modId },
      { $set: { mustChangePassword: true } },
    );
    await upload().expect(403);
    await users.updateOne(
      { _id: modId },
      { $set: { mustChangePassword: false, status: 'suspended' } },
    );
    await upload().expect(401);
    expect(readdirSync(uploadDir)).toEqual([]);
  });
  it('rejects invalid bytes, missing/multiple/oversized files, unknown fields and malformed identifiers', async () => {
    await mod
      .post(url())
      .attach('file', Buffer.from('not an image'), {
        filename: 'fake.png',
        contentType: 'image/png',
      })
      .expect(400);
    await mod.post(url()).send({}).expect(400);
    await mod
      .post(url())
      .attach('file', PNG, 'one.png')
      .attach('file', PNG, 'two.png')
      .expect(400);
    await mod
      .post(url())
      .attach('file', Buffer.alloc(MAX_IMAGE_BYTES + 1), 'oversize.png')
      .expect(413);
    await mod
      .post(url())
      .field('logoUrl', 'https://example.com/untrusted.png')
      .attach('file', PNG, 'logo.png')
      .expect(400);
    await admin
      .post('/api/airlines/invalid/logo')
      .attach('file', PNG, 'logo.png')
      .expect(400);
    await admin
      .post('/api/airlines/' + new Types.ObjectId() + '/logo')
      .attach('file', PNG, 'logo.png')
      .expect(404);
    await admin
      .post('/api/airlines')
      .field('name', 'Untrusted')
      .field('code', 'GG')
      .field('moderatorId', modId.toString())
      .attach('file', PNG, 'logo.png')
      .expect(400);
    expect(readdirSync(uploadDir)).toEqual([]);
  });
  it('rolls back profile creation and removes the new file on duplicate or audit-persistence failure', async () => {
    await admin
      .post('/api/airlines')
      .field('name', 'Duplicate')
      .field('code', 'AA')
      .attach('file', PNG, 'logo.png')
      .expect(409);
    const spy = jest
      .spyOn(app.get(DomainEventPublisherService), 'publish')
      .mockRejectedValueOnce(new Error('Synthetic audit persistence failure'));
    await admin
      .post('/api/airlines')
      .field('name', 'Rollback')
      .field('code', 'RR')
      .attach('file', PNG, 'logo.png')
      .expect(500);
    spy.mockRestore();
    expect(await airlines.countDocuments()).toBe(2);
    expect(await events.countDocuments()).toBe(0);
    expect(readdirSync(uploadDir)).toEqual([]);
  });
  it('preserves the old logo and business state when replacement audit persistence fails', async () => {
    const before = (await upload().expect(201)).body;
    const spy = jest
      .spyOn(app.get(DomainEventPublisherService), 'publish')
      .mockRejectedValueOnce(new Error('Synthetic audit persistence failure'));
    await upload().expect(500);
    spy.mockRestore();
    expect((await airlines.findById(airlineId).orFail()).logoUrl).toBe(
      before.logoUrl,
    );
    expect(readdirSync(uploadDir)).toEqual([imageId(before.logoUrl)]);
    await request(app.getHttpServer()).get(before.logoUrl).expect(200);
    expect(await events.countDocuments()).toBe(1);
  });
  it('serializes concurrent replacements to one current owned image without deleting the winner', async () => {
    await upload().expect(201);
    const responses = await Promise.all([
      upload().expect(201),
      upload(admin).expect(201),
    ]);
    const final = await airlines
      .findById(airlineId)
      .select('+logoImage')
      .orFail();
    expect(responses.map((r) => r.body.logoUrl)).toContain(final.logoUrl);
    expect(readdirSync(uploadDir)).toEqual([imageId(final.logoUrl)]);
    expect(final.logoImage?.url).toBe(final.logoUrl);
    await request(app.getHttpServer()).get(final.logoUrl).expect(200);
    expect(await events.countDocuments()).toBe(3);
  });
  it('allows echoing the current stored URL, rejects borrowing another file, and cleans an owned file after legacy URL replacement', async () => {
    const own = (await upload().expect(201)).body;
    await mod
      .patch('/api/airlines/' + airlineId)
      .send({ name: 'Renamed', logoUrl: own.logoUrl })
      .expect(200);
    expect(existsSync(join(uploadDir, imageId(own.logoUrl)))).toBe(true);
    const foreign = (
      await admin
        .post('/api/airlines')
        .field('name', 'Another Uploaded')
        .field('code', 'HH')
        .attach('file', PNG, 'other.png')
        .expect(201)
    ).body;
    await mod
      .patch('/api/airlines/' + airlineId)
      .send({ logoUrl: foreign.logoUrl })
      .expect(400);
    await mod
      .patch('/api/airlines/' + airlineId)
      .send({ logoUrl: 'https://example.com/replacement.png' })
      .expect(200);
    expect(readdirSync(uploadDir)).toEqual([imageId(foreign.logoUrl)]);
    expect(
      (await airlines.findById(airlineId).select('+logoImage').orFail())
        .logoImage,
    ).toBeUndefined();
    for (const field of ['name', 'code', 'logoUrl'])
      await mod
        .patch('/api/airlines/' + airlineId)
        .send({ [field]: null })
        .expect(400);
    await mod
      .patch('/api/airlines/' + airlineId)
      .send({ logoImage: { id: 'forged' } })
      .expect(400);
  });
  it('documents multipart creation/replacement, cookie protection, upload limits and the current logo URL', async () => {
    const doc = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    expect(
      doc.paths['/api/airlines'].post.requestBody.content[
        'multipart/form-data'
      ],
    ).toBeDefined();
    expect(
      doc.paths['/api/airlines'].post.requestBody.content['application/json'],
    ).toBeDefined();
    const op = doc.paths['/api/airlines/{id}/logo'].post;
    expect(op.security).toContainEqual({ giu_session: [] });
    expect(
      op.requestBody.content['multipart/form-data'].schema.properties.file,
    ).toMatchObject({ type: 'string', format: 'binary' });
    expect(op.responses['413']).toBeDefined();
    expect(doc.components.schemas.AirlineViewDto.required).toContain('logoUrl');
  });
});
