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
import { AdministrationModule } from '../src/modules/administration/administration.module';
import { ModeratorAssignment } from '../src/modules/administration/schemas/moderator-assignment.schema';
import { AuditLog } from '../src/modules/audit-logging/schemas/audit-log.schema';
import { hashPassword } from '../src/modules/auth/security/password';
import { DomainEventConsumer } from '../src/modules/domain-events/domain-event-consumer';
import { DomainEventPublisherService } from '../src/modules/domain-events/domain-event-publisher.service';
import { DomainEventOutbox } from '../src/modules/domain-events/schemas/domain-event-outbox.schema';
import { Hotel } from '../src/modules/hotels/schemas/hotel.schema';
import { User } from '../src/modules/users/schemas/user.schema';

const uploadDir = mkdtempSync(join(tmpdir(), 'giu-hotel-audit-'));
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP4UAAAAASUVORK5CYII=',
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
const profile = {
  name: 'Audit Hotel',
  description: 'Private description that must not enter audit records',
  address: 'Private street address',
  cityId: 'cairo',
  countryCode: 'EG',
  starRating: 4,
};
const policies = {
  checkInTime: '15:00',
  checkOutTime: '11:00',
  cancellationTiers: [{ daysBefore: 7, refundPercent: 90 }],
};

describe('GEN-07 hotel profile and image mutation producers (actual admin/module/consumer/database/files)', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryReplSet, app: INestApplication, connection: Connection;
  let users: Model<User>,
    hotels: Model<Hotel>,
    assignments: Model<ModeratorAssignment>,
    events: Model<DomainEventOutbox>,
    archive: Model<AuditLog>;
  let admin: Agent, mod: Agent, otherMod: Agent, traveler: Agent;
  let adminId: Types.ObjectId,
    modId: Types.ObjectId,
    hotelId: Types.ObjectId,
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
          dbName: 'giu_hotel_profile_audit',
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
      SwaggerModule.createDocument(
        app,
        new DocumentBuilder()
          .setTitle('Hotel audit')
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
    hotels = app.get(getModelToken(Hotel.name));
    assignments = app.get(getModelToken(ModeratorAssignment.name));
    events = app.get(getModelToken(DomainEventOutbox.name));
    archive = app.get(getModelToken(AuditLog.name));
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    passwordHash = await hashPassword('hotel-audit-password1');
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
        roles: ['hotel_moderator'],
        passwordHash,
      },
      {
        email: 'other-mod@example.com',
        fullName: 'Other Moderator',
        roles: ['hotel_moderator'],
        passwordHash,
      },
      { email: 'traveler@example.com', fullName: 'Traveler', passwordHash },
    ]);
    adminId = accounts[0]._id;
    modId = accounts[1]._id;
    const providers = await hotels.create([
      profile,
      { ...profile, name: 'Other Hotel' },
    ]);
    hotelId = providers[0]._id;
    await assignments.create([
      {
        userId: modId,
        providerType: 'hotel',
        providerId: hotelId,
        assignedBy: adminId,
      },
      {
        userId: accounts[2]._id,
        providerType: 'hotel',
        providerId: providers[1]._id,
        assignedBy: adminId,
      },
    ]);
    admin = await login('admin@example.com');
    mod = await login('mod@example.com');
    otherMod = await login('other-mod@example.com');
    traveler = await login('traveler@example.com');
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
      !basename(target).startsWith('giu-hotel-audit-')
    )
      throw new Error('Unsafe test cleanup path');
    rmSync(target, { recursive: true, force: true });
  });
  async function login(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/login')
      .send({ email, password: 'hotel-audit-password1' })
      .expect(200);
    return agent;
  }
  const path = () => '/api/hotels/' + hotelId;
  const upload = (agent = admin) =>
    agent.post(path() + '/images').attach('file', PNG, 'image.png');
  async function history(query = '') {
    return (await admin.get('/api/admin/audit-logs' + query).expect(200)).body;
  }
  function failAudit() {
    return jest
      .spyOn(app.get(DomainEventPublisherService), 'publish')
      .mockRejectedValueOnce(new Error('Synthetic audit persistence failure'));
  }

  it('commits actual admin profile actions with private projection, immediate reads and durable deduplicated archive', async () => {
    const created = (
      await admin
        .post('/api/hotels')
        .send({ ...profile, name: 'Created Hotel' })
        .expect(201)
    ).body;
    await admin
      .patch('/api/hotels/' + created.id)
      .send({ name: 'Edited Hotel' })
      .expect(200);
    const before = await history();
    expect(before.meta.total).toBe(2);
    expect(
      new Set(before.data.map((row: { action: string }) => row.action)),
    ).toEqual(new Set(['hotel.created', 'hotel.updated']));
    for (const row of before.data)
      expect(row).toMatchObject({
        actorId: adminId.toString(),
        target: { type: 'hotel', id: created.id },
        outcome: 'committed',
        deliveryStatus: 'pending',
      });
    expect(JSON.stringify(await events.find().lean())).not.toMatch(
      /Private description|Private street|Edited Hotel|password|email/,
    );
    await request(app.getHttpServer())
      .get('/api/hotels/' + created.id)
      .expect(200);
    const consumer = app.get(DomainEventConsumer);
    expect(await consumer.consumePending()).toBe(2);
    expect(await consumer.consumePending()).toBe(0);
    const delivered = await history();
    expect(delivered.meta.total).toBe(2);
    expect(
      delivered.data.every(
        (row: { deliveryStatus: string }) => row.deliveryStatus === 'delivered',
      ),
    ).toBe(true);
    expect(await archive.countDocuments()).toBe(2);
    await events.deleteMany({});
    expect((await history()).meta.total).toBe(2);
  });
  it('records assigned moderator profile, policy, photo addition and deletion with actual actor and image identifiers', async () => {
    await mod.patch(path()).send({ name: 'Own Hotel' }).expect(200);
    await mod
      .put(path() + '/policies')
      .send(policies)
      .expect(200);
    const added = (await upload(mod).expect(201)).body;
    const image = added.images[0];
    await mod.delete(path() + '/images/' + image.id).expect(200);
    const rows = await events.find().lean();
    expect(rows).toHaveLength(4);
    expect(rows.every((row) => row.actorId === modId.toString())).toBe(true);
    expect(new Set(rows.map((row) => row.type))).toEqual(
      new Set([
        'hotel.updated',
        'hotel.policies_updated',
        'hotel.image_added',
        'hotel.image_removed',
      ]),
    );
    for (const row of rows.filter((row) => row.type.startsWith('hotel.image_')))
      expect(row.payload.audit?.metadata).toEqual({ imageId: image.id });
    expect((await history('?actorId=' + modId)).meta.total).toBe(4);
    expect(readdirSync(uploadDir)).toEqual([]);
  });
  it('rejects unauthorized and invalid mutations without generating committed audit records', async () => {
    await request(app.getHttpServer())
      .post('/api/hotels')
      .send(profile)
      .expect(401);
    await traveler.patch(path()).send({ name: 'Denied' }).expect(403);
    await otherMod.patch(path()).send({ name: 'Denied' }).expect(403);
    await mod.post('/api/hotels').send(profile).expect(403);
    await admin
      .put(path() + '/policies')
      .send(policies)
      .expect(403);
    await admin
      .patch(path())
      .send({ cityId: 'new-york', countryCode: 'EG' })
      .expect(400);
    await mod
      .put(path() + '/policies')
      .send({
        ...policies,
        cancellationTiers: [
          { daysBefore: 7, refundPercent: 80 },
          { daysBefore: 7, refundPercent: 50 },
        ],
      })
      .expect(400);
    await admin.patch(path()).send({ name: null }).expect(400);
    expect(await events.countDocuments()).toBe(0);
    expect((await hotels.findById(hotelId).orFail()).name).toBe(profile.name);
  });
  it('rolls back admin profile creation and editing when audit persistence fails', async () => {
    let spy = failAudit();
    await admin
      .post('/api/hotels')
      .send({ ...profile, name: 'Rollback Create' })
      .expect(500);
    spy.mockRestore();
    expect(await hotels.countDocuments()).toBe(2);
    spy = failAudit();
    await admin.patch(path()).send({ name: 'Rollback Edit' }).expect(500);
    spy.mockRestore();
    expect((await hotels.findById(hotelId).orFail()).name).toBe(profile.name);
    expect(await events.countDocuments()).toBe(0);
  });
  it('rolls back policies and removes only a new photo when audit persistence fails', async () => {
    const before = await hotels.findById(hotelId).lean();
    let spy = failAudit();
    await mod
      .put(path() + '/policies')
      .send(policies)
      .expect(500);
    spy.mockRestore();
    expect(await hotels.findById(hotelId).lean()).toEqual(before);
    spy = failAudit();
    await upload().expect(500);
    spy.mockRestore();
    expect((await hotels.findById(hotelId).orFail()).images).toHaveLength(0);
    expect(readdirSync(uploadDir)).toEqual([]);
    expect(await events.countDocuments()).toBe(0);
  });
  it('retains the old image file and metadata on failed removal, then cleans only after committed deletion', async () => {
    const image = (await upload().expect(201)).body.images[0];
    const spy = failAudit();
    await admin.delete(path() + '/images/' + image.id).expect(500);
    spy.mockRestore();
    expect((await hotels.findById(hotelId).orFail()).images).toHaveLength(1);
    expect(existsSync(join(uploadDir, image.id))).toBe(true);
    expect(await events.countDocuments()).toBe(1);
    await request(app.getHttpServer()).get(image.url).expect(200);
    await admin.delete(path() + '/images/' + image.id).expect(200);
    await request(app.getHttpServer()).get(image.url).expect(404);
    expect(await events.countDocuments({ type: 'hotel.image_removed' })).toBe(
      1,
    );
  });
  it('keeps the shared five-image cap and one committed audit per successful concurrent append', async () => {
    const results = await Promise.all(
      Array.from({ length: 6 }, () => upload()),
    );
    expect(results.map((row) => row.status).sort()).toEqual([
      201, 201, 201, 201, 201, 400,
    ]);
    expect((await hotels.findById(hotelId).orFail()).images).toHaveLength(5);
    expect(readdirSync(uploadDir)).toHaveLength(5);
    expect(await events.countDocuments({ type: 'hotel.image_added' })).toBe(5);
  });
  it('merges concurrent partial edits while recording both committed actions', async () => {
    await Promise.all([
      admin.patch(path()).send({ address: 'Changed Address' }).expect(200),
      mod
        .patch(path())
        .send({ description: 'Changed Description' })
        .expect(200),
    ]);
    expect(await hotels.findById(hotelId).lean()).toMatchObject({
      address: 'Changed Address',
      description: 'Changed Description',
    });
    expect(await events.countDocuments({ type: 'hotel.updated' })).toBe(2);
  });
  it('filters and paginates the new real actions without exposing edited profile bodies', async () => {
    for (let index = 0; index < 11; index++)
      await admin
        .patch(path())
        .send({ description: 'Private description ' + index })
        .expect(200);
    await mod
      .patch(path())
      .send({ description: 'Private moderator description' })
      .expect(200);
    const first = await history('?action=hotel.updated'),
      second = await history('?action=hotel.updated&page=2');
    expect(first.meta).toEqual({
      page: 1,
      limit: 10,
      total: 12,
      totalPages: 2,
    });
    expect(first.data).toHaveLength(10);
    expect(second.data).toHaveLength(2);
    expect(
      (await history('?actorId=' + modId + '&action=hotel.updated')).meta.total,
    ).toBe(1);
    expect(JSON.stringify(first)).not.toMatch(
      /Private|description|address|password/,
    );
  });
  it('documents all new action filters and preserves protected write and audit routes', async () => {
    const doc = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    const action = doc.paths['/api/admin/audit-logs'].get.parameters.find(
      (p: { name: string }) => p.name === 'action',
    );
    for (const name of [
      'hotel.created',
      'hotel.updated',
      'hotel.policies_updated',
      'hotel.image_added',
      'hotel.image_removed',
    ])
      expect(action.schema.enum).toContain(name);
    expect(doc.paths['/api/hotels'].post.security).toContainEqual({
      giu_session: [],
    });
    await mod.get('/api/admin/audit-logs').expect(403);
  });
});
