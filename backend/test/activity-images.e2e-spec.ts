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
import { Connection, Model, Types } from 'mongoose';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  unlinkSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { hashPassword } from '../src/modules/auth/security/password';
import { CommunityModule } from '../src/modules/community/community.module';
import { ActivityMediaStorage } from '../src/modules/itineraries/activity-media.storage';
import { ItinerariesModule } from '../src/modules/itineraries/itineraries.module';
import { Itinerary } from '../src/modules/itineraries/schemas/itinerary.schema';
import {
  IMAGE_ID_PATTERN,
  MAX_IMAGE_BYTES,
} from '../src/modules/media-uploads/media.service';
import { User } from '../src/modules/users/schemas/user.schema';

const mediaRoot = mkdtempSync(join(tmpdir(), 'giu-activity-media-'));
const activityDirectory = join(mediaRoot, 'activities');
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=',
  'base64',
);
const JPG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
type Agent = ReturnType<typeof request.agent>;
type ImageView = { id: string; url: string };
type TripView = {
  id: string;
  days: { id: string; activities: { id: string; images: ImageView[] }[] }[];
};

@Global()
@Module({
  providers: [
    {
      provide: ConfigService,
      useValue: new ConfigService({
        NODE_ENV: 'test',
        MEDIA_UPLOAD_DIR: mediaRoot,
      }),
    },
  ],
  exports: [ConfigService],
})
class TestConfigurationModule {}

describe('Activity image privacy, limits, cloning and file/database consistency', () => {
  jest.setTimeout(180_000);
  let app: INestApplication;
  let server: MongoMemoryReplSet;
  let connection: Connection;
  let users: Model<User>;
  let itineraries: Model<Itinerary>;
  let owner: Agent;
  let other: Agent;
  let admin: Agent;
  let ownerId: string;
  let tripId: string;
  let dayId: string;
  let activityId: string;
  let passwordHash: string;

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), {
          dbName: 'giu_activity_images',
        }),
        ItinerariesModule,
        CommunityModule,
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
    itineraries = app.get(getModelToken(Itinerary.name));
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
    for (const filename of files()) {
      if (!IMAGE_ID_PATTERN.test(filename))
        throw new Error('Unexpected test media path');
      unlinkSync(join(activityDirectory, filename));
    }
    const accounts = await users.create([
      { email: 'owner@example.com', fullName: 'Owner', passwordHash },
      { email: 'other@example.com', fullName: 'Other', passwordHash },
      {
        email: 'admin@example.com',
        fullName: 'Admin',
        roles: ['admin'],
        passwordHash,
      },
    ]);
    ownerId = accounts[0]._id.toString();
    owner = await signIn('owner@example.com');
    other = await signIn('other@example.com');
    admin = await signIn('admin@example.com');
    tripId = (
      await owner
        .post('/api/itineraries')
        .send({
          title: 'Images',
          countryCodes: ['EG'],
          startDate: '2028-01-01',
        })
        .expect(201)
    ).body.id;
    dayId = (
      await owner
        .post(`/api/itineraries/${tripId}/days`)
        .send({ cityId: 'cairo' })
        .expect(201)
    ).body.days[0].id;
    activityId = (
      await owner
        .post(`/api/itineraries/${tripId}/days/${dayId}/activities`)
        .send({ name: 'Museum' })
        .expect(201)
    ).body.days[0].activities[0].id;
  });
  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await app?.close();
    await server?.stop();
    if (!mediaRoot.startsWith(join(tmpdir(), 'giu-activity-media-')))
      throw new Error('Unexpected cleanup target');
    rmSync(mediaRoot, { recursive: true, force: true });
  });
  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/login')
      .send({ email, password: 'test-password1' })
      .expect(200);
    return agent;
  }
  function files(): string[] {
    return existsSync(activityDirectory) ? readdirSync(activityDirectory) : [];
  }
  function upload(agent = owner, bytes = PNG, filename = 'image.png') {
    return agent
      .post(`/api/activities/${activityId}/images`)
      .attach('file', bytes, filename);
  }
  async function image(): Promise<ImageView> {
    return (await upload().expect(201)).body.days[0].activities[0].images[0];
  }
  async function publish(): Promise<ImageView> {
    await owner
      .patch(`/api/itineraries/${tripId}`)
      .send({ visibility: 'public' })
      .expect(200);
    const trip: TripView = (
      await request(app.getHttpServer())
        .get(`/api/itineraries/public/${tripId}`)
        .expect(200)
    ).body;
    return trip.days[0].activities[0].images[0];
  }

  it('stores a validated image with an owned URL and never exposes it through generic public media', async () => {
    const uploaded = await image();
    expect(uploaded.url).toBe(
      `/api/activities/${activityId}/images/${uploaded.id}`,
    );
    expect(files()).toEqual([uploaded.id]);
    const response = await owner
      .get(uploaded.url)
      .expect(200)
      .expect('Content-Type', /image\/png/)
      .expect('Cache-Control', 'no-store')
      .expect('X-Content-Type-Options', 'nosniff');
    expect(response.body).toEqual(PNG);
    await request(app.getHttpServer())
      .get(`/api/media/${uploaded.id}`)
      .expect(404);
    expect(
      (await owner.get(`/api/itineraries/${tripId}`).expect(200)).body.days[0]
        .activities[0].images,
    ).toEqual([uploaded]);
  });

  it('uses actual JPEG content rather than a forged extension or client content type', async () => {
    const uploaded: ImageView = (
      await upload(owner, JPG, 'forged.png').expect(201)
    ).body.days[0].activities[0].images[0];
    expect(uploaded.id).toMatch(/\.jpg$/);
    expect(
      (
        await owner
          .get(uploaded.url)
          .expect(200)
          .expect('Content-Type', /image\/jpeg/)
      ).body,
    ).toEqual(JPG);
  });

  it('rejects missing, invalid, oversized and extra multipart fields without writing files', async () => {
    await owner.post(`/api/activities/${activityId}/images`).expect(400);
    await upload(owner, Buffer.from('not an image'), 'forged.png').expect(400);
    await upload(
      owner,
      Buffer.concat([PNG, Buffer.alloc(MAX_IMAGE_BYTES)]),
      'large.png',
    ).expect(413);
    await owner
      .post(`/api/activities/${activityId}/images`)
      .field('images', 'untrusted')
      .attach('file', PNG, 'image.png')
      .expect(400);
    expect(files()).toHaveLength(0);
  });

  it('enforces authentication, ownership and staff restrictions before upload/read/delete', async () => {
    const uploaded = await image();
    await request(app.getHttpServer())
      .post(`/api/activities/${activityId}/images`)
      .attach('file', PNG, 'x.png')
      .expect(401);
    await upload(other).expect(404);
    await upload(admin).expect(403);
    await request(app.getHttpServer()).get(uploaded.url).expect(401);
    await other.get(uploaded.url).expect(404);
    await admin.get(uploaded.url).expect(403);
    await other.delete(uploaded.url).expect(404);
    await owner
      .get(`/api/activities/${new Types.ObjectId()}/images/${uploaded.id}`)
      .expect(404);
    await owner.get(`/api/activities/${activityId}/images/invalid`).expect(400);
    expect(files()).toHaveLength(1);
  });

  it('caps each activity at five images and permits replacement after removal', async () => {
    for (let index = 0; index < 5; index++) await upload().expect(201);
    await upload().expect(409);
    expect(files()).toHaveLength(5);
    const first: ImageView = (
      await owner.get(`/api/itineraries/${tripId}`).expect(200)
    ).body.days[0].activities[0].images[0];
    await owner.delete(first.url).expect(200);
    await owner.get(first.url).expect(404);
    await owner.delete(first.url).expect(404);
    await upload().expect(201);
    expect(files()).toHaveLength(5);
  });

  it('keeps the five-image cap under concurrent uploads and cleans losing files', async () => {
    for (let index = 0; index < 4; index++) await upload().expect(201);
    const responses = await Promise.all([upload(), upload(), upload()]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409, 409,
    ]);
    expect(files()).toHaveLength(5);
    expect(
      (await owner.get(`/api/itineraries/${tripId}`).expect(200)).body.days[0]
        .activities[0].images,
    ).toHaveLength(5);
  });

  it('serves public URLs only while visible, and respects actual admin hiding', async () => {
    const uploaded = await image();
    const publicImage = await publish();
    expect(
      (await request(app.getHttpServer()).get(publicImage.url).expect(200))
        .body,
    ).toEqual(PNG);
    await owner
      .patch(`/api/itineraries/${tripId}`)
      .send({ visibility: 'private' })
      .expect(200);
    await request(app.getHttpServer()).get(publicImage.url).expect(404);
    await publish();
    await admin
      .patch(`/api/admin/content/itinerary/${tripId}/hide`)
      .send({})
      .expect(204);
    await request(app.getHttpServer()).get(publicImage.url).expect(404);
    await owner.get(uploaded.url).expect(200);
    await owner
      .patch(`/api/itineraries/${tripId}`)
      .send({ visibility: 'public' })
      .expect(409);
  });

  it('preserves suspended-author visibility and hides deactivated-author images', async () => {
    await image();
    const publicImage = await publish();
    await users.updateOne({ _id: ownerId }, { $set: { status: 'suspended' } });
    await request(app.getHttpServer()).get(publicImage.url).expect(200);
    await users.updateOne(
      { _id: ownerId },
      { $set: { status: 'deactivated' } },
    );
    await request(app.getHttpServer()).get(publicImage.url).expect(404);
  });

  it('gives clones independent files and URLs that survive source deletion', async () => {
    const original = await image();
    await publish();
    const clone: TripView = (
      await other.post(`/api/itineraries/${tripId}/clone`).expect(201)
    ).body;
    const copied = clone.days[0].activities[0].images[0];
    expect(copied.id).not.toBe(original.id);
    expect(copied.url).toContain(
      `/activities/${clone.days[0].activities[0].id}/`,
    );
    await owner.delete(`/api/itineraries/${tripId}`).expect(204);
    expect(files()).toEqual([copied.id]);
    expect((await other.get(copied.url).expect(200)).body).toEqual(PNG);
    await request(app.getHttpServer()).get(copied.url).expect(401);
    await other.delete(copied.url).expect(200);
    expect(files()).toHaveLength(0);
  });

  it('removes an uploaded file when saving its metadata fails', async () => {
    jest
      .spyOn(itineraries.prototype, 'save')
      .mockRejectedValueOnce(new Error('Injected persistence failure'));
    await upload().expect(500);
    expect(files()).toHaveLength(0);
    expect(
      (await owner.get(`/api/itineraries/${tripId}`).expect(200)).body.days[0]
        .activities[0].images,
    ).toEqual([]);
  });

  it('retains the file and metadata if image removal cannot save', async () => {
    const uploaded = await image();
    jest
      .spyOn(itineraries.prototype, 'save')
      .mockRejectedValueOnce(new Error('Injected persistence failure'));
    await owner.delete(uploaded.url).expect(500);
    expect(files()).toEqual([uploaded.id]);
    await owner.get(uploaded.url).expect(200);
    expect(
      (await owner.get(`/api/itineraries/${tripId}`).expect(200)).body.days[0]
        .activities[0].images,
    ).toHaveLength(1);
  });

  it('cleans partial clone files on copy failure without changing the source or creating a clone', async () => {
    await image();
    await upload().expect(201);
    await publish();
    const storage = app.get(ActivityMediaStorage);
    const originalCopy = storage.copy.bind(storage);
    jest
      .spyOn(storage, 'copy')
      .mockImplementationOnce(originalCopy)
      .mockRejectedValueOnce(
        new ServiceUnavailableException('Injected copy failure'),
      );
    await other.post(`/api/itineraries/${tripId}/clone`).expect(503);
    expect(files()).toHaveLength(2);
    expect(await itineraries.countDocuments()).toBe(1);
  });

  it('cleans copied files if persisting a clone fails', async () => {
    await image();
    await publish();
    jest
      .spyOn(itineraries.prototype, 'save')
      .mockRejectedValueOnce(new Error('Injected clone failure'));
    await other.post(`/api/itineraries/${tripId}/clone`).expect(500);
    expect(files()).toHaveLength(1);
    expect(await itineraries.countDocuments()).toBe(1);
  });

  it.each(['activity', 'day', 'itinerary'])(
    'cleans files after successful %s deletion',
    async (kind) => {
      await image();
      const path =
        kind === 'activity'
          ? `/api/activities/${activityId}`
          : kind === 'day'
            ? `/api/itineraries/${tripId}/days/${dayId}`
            : `/api/itineraries/${tripId}`;
      await owner.delete(path).expect(kind === 'itinerary' ? 204 : 200);
      expect(files()).toHaveLength(0);
    },
  );

  it('treats legacy absent metadata as empty and allows a normal upload', async () => {
    await itineraries.updateOne(
      { _id: tripId },
      { $unset: { 'days.0.activities.0.images': 1 } },
    );
    expect(
      (await owner.get(`/api/itineraries/${tripId}`).expect(200)).body.days[0]
        .activities[0].images,
    ).toEqual([]);
    await upload().expect(201);
  });

  it('documents multipart uploads, binary images and access-checked metadata', async () => {
    const doc = (
      await request(app.getHttpServer()).get('/api/docs-json').expect(200)
    ).body;
    expect(
      doc.paths['/api/activities/{id}/images'].post.requestBody.content[
        'multipart/form-data'
      ],
    ).toBeDefined();
    expect(
      doc.paths['/api/activities/{id}/images/{imageId}'].get.security,
    ).toBeDefined();
    expect(
      doc.components.schemas.ActivityViewDto.properties.images.items.$ref,
    ).toContain('ActivityImageViewDto');
  });
});
