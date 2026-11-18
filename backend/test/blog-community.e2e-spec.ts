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
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { OutboxEvent } from '../src/common/events/outbox-event.schema';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { hashPassword } from '../src/modules/auth/security/password';
import { BlogPost } from '../src/modules/blog/schemas/blog.schemas';
import { CommunityModule } from '../src/modules/community/community.module';
import { Hotel } from '../src/modules/hotels/schemas/hotel.schema';
import { Itinerary } from '../src/modules/itineraries/schemas/itinerary.schema';
import { ItinerariesModule } from '../src/modules/itineraries/itineraries.module';
import { Review } from '../src/modules/reviews/schemas/review.schema';
import { User } from '../src/modules/users/schemas/user.schema';

const uploadDir = mkdtempSync(join(tmpdir(), 'giu-blog-media-'));

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
const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

describe('Blog, community reports and moderation (real HTTP and MongoDB)', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryReplSet;
  let app: INestApplication;
  let connection: Connection;
  let users: Model<User>;
  let posts: Model<BlogPost>;
  let itineraries: Model<Itinerary>;
  let hotels: Model<Hotel>;
  let reviews: Model<Review>;
  let outbox: Model<OutboxEvent>;
  let passwordHash: string;

  let admin: Agent;
  let author: Agent;
  let reader: Agent;
  let authorId: string;

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), { dbName: 'giu_blog_tests' }),
        CommunityModule,
        ItinerariesModule,
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
    posts = app.get(getModelToken(BlogPost.name));
    itineraries = app.get(getModelToken(Itinerary.name));
    hotels = app.get(getModelToken(Hotel.name));
    reviews = app.get(getModelToken(Review.name));
    outbox = app.get(getModelToken(OutboxEvent.name));
    await Promise.all(
      connection.modelNames().map((name) => connection.model(name).init()),
    );
    passwordHash = await hashPassword('test-password1');
  });

  afterAll(async () => {
    await app?.close();
    await server?.stop();
    rmSync(uploadDir, { recursive: true, force: true });
  });

  beforeEach(async () => {
    await Promise.all(
      Object.values(connection.collections).map((collection) =>
        collection.deleteMany({}),
      ),
    );
    const accounts = await users.create([
      {
        email: 'admin@example.com',
        fullName: 'Admin',
        roles: ['admin'],
        passwordHash,
      },
      { email: 'author@example.com', fullName: 'Amira Writer', passwordHash },
      { email: 'reader@example.com', fullName: 'Rami Reader', passwordHash },
    ]);
    authorId = accounts[1]._id.toString();
    [admin, author, reader] = await Promise.all(
      accounts.map((account) => signIn(account.email)),
    );
  });

  async function signIn(email: string) {
    const agent = request.agent(app.getHttpServer());
    await agent
      .post('/api/auth/login')
      .send({ email, password: 'test-password1' })
      .expect(200);
    return agent;
  }

  async function publish(title: string, tags: string[] = [], agent = author) {
    const post = await agent
      .post('/api/posts')
      .send({ title, body: `About ${title}`, tags, status: 'published' })
      .expect(201);
    return post.body.id as string;
  }

  const guest = () => request(app.getHttpServer());

  describe('posts (BLG-01..BLG-04, BLG-08)', () => {
    it('keeps drafts private and lets only the author change a post', async () => {
      const draft = await author
        .post('/api/posts')
        .send({ title: 'Draft', body: 'Not yet' })
        .expect(201);
      expect(draft.body).toMatchObject({ status: 'draft', publishedAt: null });
      const published = await publish('Cairo food', ['Egypt', ' FOOD ']);

      const list = await guest().get('/api/posts').expect(200);
      expect(
        list.body.data.map((post: { title: string }) => post.title),
      ).toEqual(['Cairo food']);
      expect(list.body.data[0]).toMatchObject({
        author: { id: authorId, name: 'Amira Writer' },
        tags: ['egypt', 'food'],
      });
      await guest().get(`/api/posts/${draft.body.id}`).expect(404);
      const page = await guest().get(`/api/posts/${published}`).expect(200);
      expect(page.body).toMatchObject({
        title: 'Cairo food',
        body: 'About Cairo food',
        likeCount: 0,
        commentCount: 0,
      });

      const mine = await author.get('/api/posts/mine').expect(200);
      expect(
        mine.body.data.map((post: { status: string }) => post.status).sort(),
      ).toEqual(['draft', 'published']);
      expect(
        (await reader.get('/api/posts/mine').expect(200)).body.data,
      ).toEqual([]);

      await reader
        .patch(`/api/posts/${published}`)
        .send({ title: 'Mine now' })
        .expect(403);
      await reader.delete(`/api/posts/${published}`).expect(403);
      await guest()
        .post('/api/posts')
        .send({ title: 'x', body: 'y' })
        .expect(401);
      await admin
        .post('/api/posts')
        .send({ title: 'x', body: 'y' })
        .expect(403);

      const publishedDraft = await author
        .patch(`/api/posts/${draft.body.id}`)
        .send({ status: 'published' })
        .expect(200);
      expect(publishedDraft.body.publishedAt).not.toBeNull();
      await author.delete(`/api/posts/${published}`).expect(204);
      await guest().get(`/api/posts/${published}`).expect(404);
    });

    it('validates title, body and up to five tags of 30 characters', async () => {
      const send = (body: Record<string, unknown>) =>
        author.post('/api/posts').send({ title: 'T', body: 'B', ...body });
      await send({ title: '' }).expect(400);
      await send({ body: '   ' }).expect(400);
      await send({ tags: ['a', 'b', 'c', 'd', 'e', 'f'] }).expect(400);
      await send({ tags: ['x'.repeat(31)] }).expect(400);
      await send({ tags: ['Food', 'food'] }).expect(400);
      await send({ status: 'archived' }).expect(400);
      await send({ likeCount: 99 }).expect(400);
      const id = (await send({ tags: ['a', 'b', 'c', 'd', 'e'] }).expect(201))
        .body.id;
      await author.patch(`/api/posts/${id}`).send({ title: null }).expect(400);
    });
  });

  describe('browsing, tags and search (BLG-02, BLG-08, BLG-09)', () => {
    it('lists by tag and ranks searches by likes + comments, newest first on ties', async () => {
      const quiet = await publish('Quiet Nile trip', ['egypt']);
      const popular = await publish('Popular Nile trip', ['egypt']);
      const newest = await publish('Newest Nile trip', ['egypt']);
      await publish('Paris (food) guide', ['france']);
      await reader.post(`/api/posts/${popular}/like`).expect(201);
      await reader
        .post(`/api/posts/${popular}/comments`)
        .send({ body: 'Nice' })
        .expect(201);
      await reader.post(`/api/posts/${quiet}/like`).expect(201);

      const byTag = await guest().get('/api/tags/EGYPT/posts').expect(200);
      expect(byTag.body.meta.total).toBe(3);
      const search = await guest()
        .get('/api/posts')
        .query({ search: 'nile' })
        .expect(200);
      expect(search.body.data.map((post: { id: string }) => post.id)).toEqual([
        popular,
        quiet,
        newest,
      ]);
      expect(
        (await guest().get('/api/posts').query({ search: 'amira' }).expect(200))
          .body.meta.total,
      ).toBe(4);
      expect(
        (
          await guest()
            .get('/api/posts')
            .query({ search: 'france' })
            .expect(200)
        ).body.meta.total,
      ).toBe(1);
      expect(
        (
          await guest()
            .get('/api/posts')
            .query({ search: '(food)' })
            .expect(200)
        ).body.meta.total,
      ).toBe(1);
      expect(
        (
          await guest()
            .get('/api/posts')
            .query({ search: 'nothing here' })
            .expect(200)
        ).body,
      ).toMatchObject({ data: [], meta: { total: 0 } });
    });

    it('paginates ten posts per page', async () => {
      for (let i = 0; i < 12; i++) await publish(`Post ${i}`);
      const first = await guest().get('/api/posts').expect(200);
      const second = await guest()
        .get('/api/posts')
        .query({ page: 2 })
        .expect(200);
      expect(first.body.meta).toEqual({
        page: 1,
        limit: 10,
        total: 12,
        totalPages: 2,
      });
      expect(second.body.data).toHaveLength(2);
    });
  });

  describe('comments and likes (BLG-05..BLG-07)', () => {
    let postId: string;
    beforeEach(async () => {
      postId = await publish('Comment me');
    });

    it('accepts 1-500 character comments in order and lets only their author edit them', async () => {
      await reader
        .post(`/api/posts/${postId}/comments`)
        .send({ body: '   ' })
        .expect(400);
      await reader
        .post(`/api/posts/${postId}/comments`)
        .send({ body: 'x'.repeat(501) })
        .expect(400);
      const first = await reader
        .post(`/api/posts/${postId}/comments`)
        .send({ body: 'First' })
        .expect(201);
      await author
        .post(`/api/posts/${postId}/comments`)
        .send({ body: 'Second' })
        .expect(201);
      const comments = await guest()
        .get(`/api/posts/${postId}/comments`)
        .expect(200);
      expect(
        comments.body.data.map((comment: { body: string }) => comment.body),
      ).toEqual(['First', 'Second']);
      expect(
        (await guest().get(`/api/posts/${postId}`).expect(200)).body
          .commentCount,
      ).toBe(2);

      await author
        .patch(`/api/comments/${first.body.id}`)
        .send({ body: 'Hijack' })
        .expect(403);
      await author.delete(`/api/comments/${first.body.id}`).expect(403);
      await reader
        .patch(`/api/comments/${first.body.id}`)
        .send({ body: 'Edited' })
        .expect(200);
      await reader.delete(`/api/comments/${first.body.id}`).expect(204);
      expect(
        (await guest().get(`/api/posts/${postId}`).expect(200)).body
          .commentCount,
      ).toBe(1);

      const draft = await author
        .post('/api/posts')
        .send({ title: 'D', body: 'D' })
        .expect(201);
      await reader
        .post(`/api/posts/${draft.body.id}/comments`)
        .send({ body: 'Hi' })
        .expect(404);
    });

    it('counts one like per user per post', async () => {
      await guest().post(`/api/posts/${postId}/like`).expect(401);
      expect(
        (await reader.post(`/api/posts/${postId}/like`).expect(201)).body,
      ).toEqual({ liked: true, likeCount: 1 });
      await reader.post(`/api/posts/${postId}/like`).expect(409);
      const both = await Promise.all([
        author.post(`/api/posts/${postId}/like`),
        author.post(`/api/posts/${postId}/like`),
      ]);
      expect(both.map((response) => response.status).sort()).toEqual([
        201, 409,
      ]);
      expect(
        (await guest().get(`/api/posts/${postId}`).expect(200)).body.likeCount,
      ).toBe(2);
      expect(
        (await reader.delete(`/api/posts/${postId}/like`).expect(200)).body,
      ).toEqual({ liked: false, likeCount: 1 });
      await reader.delete(`/api/posts/${postId}/like`).expect(404);
    });
  });

  describe('author pages and deactivated accounts (BLG-12, ACC-12)', () => {
    it('shows the author with published posts and public itineraries only', async () => {
      await publish('Visible');
      await author
        .post('/api/posts')
        .send({ title: 'Hidden draft', body: 'x' })
        .expect(201);
      await itineraries.create([
        {
          ownerId: authorId,
          title: 'Public trip',
          countryCodes: ['EG'],
          startDate: '2026-12-01',
          visibility: 'public',
        },
        {
          ownerId: authorId,
          title: 'Private trip',
          countryCodes: ['EG'],
          startDate: '2026-12-01',
        },
      ]);
      const page = await guest().get(`/api/authors/${authorId}`).expect(200);
      expect(page.body).toMatchObject({ id: authorId, name: 'Amira Writer' });
      expect(page.body.joinedAt).toBeTruthy();
      expect(
        page.body.posts.data.map((post: { title: string }) => post.title),
      ).toEqual(['Visible']);
      expect(
        page.body.itineraries.data.map((trip: { title: string }) => trip.title),
      ).toEqual(['Public trip']);
      await guest().get(`/api/authors/${new Types.ObjectId()}`).expect(404);
    });

    it('hides a deactivated author\'s posts and names their comments "Deleted user"', async () => {
      const readerPost = await publish('Reader post', [], reader);
      const postId = await publish('Author post');
      await author
        .post(`/api/posts/${readerPost}/comments`)
        .send({ body: 'Hello' })
        .expect(201);
      await users.updateOne(
        { _id: authorId },
        { $set: { status: 'deactivated' } },
      );

      expect(
        (await guest().get('/api/posts').expect(200)).body.data.map(
          (post: { title: string }) => post.title,
        ),
      ).toEqual(['Reader post']);
      await guest().get(`/api/posts/${postId}`).expect(404);
      await guest().get(`/api/authors/${authorId}`).expect(404);
      const comments = await guest()
        .get(`/api/posts/${readerPost}/comments`)
        .expect(200);
      expect(comments.body.data[0].authorName).toBe('Deleted user');
    });
  });

  it('attaches up to five real images to my post (BLG-10, GEN-08)', async () => {
    const postId = await publish('Photos');
    await reader
      .post(`/api/posts/${postId}/images`)
      .attach('file', JPG, 'a.jpg')
      .expect(403);
    await author
      .post(`/api/posts/${postId}/images`)
      .attach('file', Buffer.from('GIF89a'), 'a.gif')
      .expect(400);
    let post;
    for (let i = 0; i < 5; i++)
      post = await author
        .post(`/api/posts/${postId}/images`)
        .attach('file', JPG, 'a.jpg')
        .expect(201);
    await author
      .post(`/api/posts/${postId}/images`)
      .attach('file', JPG, 'a.jpg')
      .expect(400);
    const image = post!.body.images[0];
    expect(
      (await guest().get(image.url).expect(200)).headers['content-type'],
    ).toBe('image/jpeg');
    expect(
      (await guest().get(`/api/posts/${postId}`).expect(200)).body.images,
    ).toHaveLength(5);
    await author.delete(`/api/posts/${postId}/images/${image.id}`).expect(200);
    await author.delete(`/api/posts/${postId}/images/${image.id}`).expect(404);
  });

  describe('reports and moderation (GEN-09, GEN-10)', () => {
    it('lets a user report visible content once, with a reason', async () => {
      const postId = await publish('Spam');
      const draft = await author
        .post('/api/posts')
        .send({ title: 'D', body: 'D' })
        .expect(201);
      const report = (body: Record<string, unknown>) =>
        reader
          .post('/api/reports')
          .send({
            targetType: 'post',
            targetId: postId,
            reason: 'Spam link',
            ...body,
          });
      await guest()
        .post('/api/reports')
        .send({ targetType: 'post', targetId: postId, reason: 'x' })
        .expect(401);
      await report({ reason: '  ' }).expect(400);
      await report({ targetType: 'user' }).expect(400);
      await report({ targetId: draft.body.id }).expect(404);
      await report({}).expect(201);
      await report({ reason: 'Again' }).expect(409);
      await reader.get('/api/admin/reports').expect(403);
      const open = await admin.get('/api/admin/reports').expect(200);
      expect(open.body.data[0]).toMatchObject({
        targetType: 'post',
        targetPreview: 'Spam',
        reason: 'Spam link',
        reporterName: 'Rami Reader',
        status: 'open',
      });
    });

    it('hides reported content, closes all its open reports and records the action', async () => {
      const postId = await publish('Offensive');
      await users.create({
        email: 'third@example.com',
        fullName: 'Third',
        passwordHash,
      });
      const third = await signIn('third@example.com');
      await reader
        .post('/api/reports')
        .send({ targetType: 'post', targetId: postId, reason: 'Rude' })
        .expect(201);
      await third
        .post('/api/reports')
        .send({ targetType: 'post', targetId: postId, reason: 'Very rude' })
        .expect(201);
      const [first] = (await admin.get('/api/admin/reports').expect(200)).body
        .data;

      const resolved = await admin
        .patch(`/api/admin/reports/${first.id}`)
        .send({ action: 'hide' })
        .expect(200);
      expect(resolved.body.status).toBe('hidden');
      await admin
        .patch(`/api/admin/reports/${first.id}`)
        .send({ action: 'dismiss' })
        .expect(409);
      expect(
        (await admin.get('/api/admin/reports').expect(200)).body.meta.total,
      ).toBe(0);
      expect(
        (
          await admin
            .get('/api/admin/reports')
            .query({ status: 'hidden' })
            .expect(200)
        ).body.meta.total,
      ).toBe(2);

      await guest().get(`/api/posts/${postId}`).expect(404);
      const mine = await author.get('/api/posts/mine').expect(200);
      expect(mine.body.data[0]).toMatchObject({ id: postId, hidden: true });
      expect(
        await outbox.countDocuments({
          type: 'moderation.content_hidden',
          'payload.targetId': postId,
          'payload.authorId': authorId,
        }),
      ).toBe(1);
    });

    it('dismisses a report without touching the content', async () => {
      const postId = await publish('Fine');
      const comment = await author
        .post(`/api/posts/${postId}/comments`)
        .send({ body: 'Totally fine' })
        .expect(201);
      const report = await reader
        .post('/api/reports')
        .send({
          targetType: 'comment',
          targetId: comment.body.id,
          reason: 'Hmm',
        })
        .expect(201);
      await admin
        .patch(`/api/admin/reports/${report.body.id}`)
        .send({ action: 'dismiss' })
        .expect(200);
      expect(
        (await guest().get(`/api/posts/${postId}/comments`).expect(200)).body
          .meta.total,
      ).toBe(1);
      expect(
        await outbox.countDocuments({ type: 'moderation.report_dismissed' }),
      ).toBe(1);
    });

    it('lets admins hide or delete any content directly', async () => {
      const postId = await publish('Busy');
      const comment = await reader
        .post(`/api/posts/${postId}/comments`)
        .send({ body: 'Bad words' })
        .expect(201);
      await reader
        .patch(`/api/admin/content/comment/${comment.body.id}/hide`)
        .expect(403);
      await admin
        .patch(`/api/admin/content/comment/${comment.body.id}/hide`)
        .expect(204);
      expect(
        (await guest().get(`/api/posts/${postId}`).expect(200)).body
          .commentCount,
      ).toBe(0);
      expect(
        (await guest().get(`/api/posts/${postId}/comments`).expect(200)).body
          .data,
      ).toEqual([]);
      await admin
        .delete(`/api/admin/content/comment/${comment.body.id}`)
        .expect(204);
      expect(
        (await guest().get(`/api/posts/${postId}`).expect(200)).body
          .commentCount,
      ).toBe(0);
      await admin
        .delete(`/api/admin/content/comment/${comment.body.id}`)
        .expect(404);
      await admin.delete(`/api/admin/content/user/${postId}`).expect(400);

      await admin.delete(`/api/admin/content/post/${postId}`).expect(204);
      expect(await posts.countDocuments()).toBe(0);
      expect(
        await outbox.countDocuments({ type: 'moderation.content_deleted' }),
      ).toBe(2);
    });

    it('moderates reviews and keeps the hotel rating in step', async () => {
      const hotel = await hotels.create({
        name: 'H',
        address: 'A',
        cityId: 'cairo',
        countryCode: 'EG',
        starRating: 3,
        ratingSum: 6,
        ratingCount: 2,
      });
      const [bad] = await reviews.create([
        {
          bookingId: new Types.ObjectId(),
          hotelId: hotel._id,
          userId: authorId,
          rating: 1,
          comment: 'Awful!!!',
        },
        {
          bookingId: new Types.ObjectId(),
          hotelId: hotel._id,
          userId: authorId,
          rating: 5,
        },
      ]);
      await reader
        .post('/api/reports')
        .send({ targetType: 'review', targetId: bad._id, reason: 'Fake' })
        .expect(201);
      const [report] = (await admin.get('/api/admin/reports').expect(200)).body
        .data;
      await admin
        .patch(`/api/admin/reports/${report.id}`)
        .send({ action: 'delete' })
        .expect(200);
      expect(await hotels.findById(hotel._id).lean()).toMatchObject({
        ratingSum: 5,
        ratingCount: 1,
      });
      expect(await reviews.countDocuments()).toBe(1);
    });

    it('accepts reports of public itineraries and hides them by making them private', async () => {
      const [shared, personal] = await itineraries.create([
        {
          ownerId: authorId,
          title: 'Shared trip',
          countryCodes: ['EG'],
          startDate: '2026-12-01',
          visibility: 'public',
        },
        {
          ownerId: authorId,
          title: 'Personal trip',
          countryCodes: ['EG'],
          startDate: '2026-12-01',
        },
      ]);
      await reader
        .post('/api/reports')
        .send({ targetType: 'itinerary', targetId: personal._id, reason: 'x' })
        .expect(404);
      const report = await reader
        .post('/api/reports')
        .send({
          targetType: 'itinerary',
          targetId: shared._id,
          reason: 'Copied',
        })
        .expect(201);
      await admin
        .patch(`/api/admin/reports/${report.body.id}`)
        .send({ action: 'hide' })
        .expect(200);
      const hidden = await itineraries.findById(shared._id).lean();
      expect(hidden!.visibility).toBe('private');
      expect(hidden!.moderationHidden).toBe(true);
      // GEN-10: the owner must not undo an admin hide via ITN-20 visibility.
      await author
        .patch(`/api/itineraries/${shared._id}`)
        .send({ visibility: 'public' })
        .expect(409);
      expect((await itineraries.findById(shared._id).lean())!.visibility).toBe(
        'private',
      );
    });
  });

  it('documents the blog and moderation routes in Swagger', async () => {
    const document = await guest().get('/api/docs-json').expect(200);
    for (const path of [
      '/api/posts',
      '/api/posts/mine',
      '/api/posts/{id}',
      '/api/posts/{id}/comments',
      '/api/posts/{id}/like',
      '/api/posts/{id}/images',
      '/api/posts/{id}/images/{imageId}',
      '/api/comments/{id}',
      '/api/tags/{tag}/posts',
      '/api/authors/{id}',
      '/api/reports',
      '/api/admin/reports',
      '/api/admin/reports/{id}',
      '/api/admin/content/{type}/{id}',
      '/api/admin/content/{type}/{id}/hide',
      '/api/media/{imageId}',
    ]) {
      expect(document.body.paths[path]).toBeDefined();
    }
  });
});
