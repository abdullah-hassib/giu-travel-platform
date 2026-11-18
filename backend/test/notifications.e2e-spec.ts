import { Global, INestApplication, Module, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import { HttpErrorFilter } from '../src/common/filters/http-error.filter';
import { hashPassword } from '../src/modules/auth/security/password';
import { User } from '../src/modules/users/schemas/user.schema';
import { Notification } from '../src/modules/notifications/schemas/notification.schema';
import { NotificationsService } from '../src/modules/notifications/notifications.service';
import { NotificationsModule } from '../src/modules/notifications/notifications.module';

@Global()
@Module({
  providers: [{ provide: ConfigService, useValue: new ConfigService({ NODE_ENV: 'test' }) }],
  exports: [ConfigService],
})
class TestConfigurationModule {}

describe('Notifications API (real HTTP and MongoDB)', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryServer;
  let app: INestApplication;
  let users: Model<User>;
  let notifications: Model<Notification>;
  let notificationService: NotificationsService;
  let passwordHash: string;
  let recipient: User;
  let otherUser: User;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    const module = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), { dbName: 'giu_notification_tests' }),
        NotificationsModule,
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    app.useGlobalFilters(new HttpErrorFilter());
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, new DocumentBuilder().setTitle('Test API').build()));
    await app.init();
    users = app.get(getModelToken(User.name));
    notifications = app.get(getModelToken(Notification.name));
    notificationService = app.get(NotificationsService);
    await Promise.all([users.init(), notifications.init()]);
    passwordHash = await hashPassword('test-password1');
  });

  beforeEach(async () => {
    await Promise.all([users.deleteMany({}), notifications.deleteMany({})]);
    [recipient, otherUser] = await users.create([
      { email: 'recipient@example.com', fullName: 'Recipient', passwordHash },
      { email: 'other@example.com', fullName: 'Other', passwordHash },
    ]);
  });

  afterAll(async () => {
    await app?.close();
    await server?.stop();
  });

  async function signIn(email = 'recipient@example.com') {
    const agent = request.agent(app.getHttpServer());
    await agent.post('/api/auth/login').send({ email, password: 'test-password1' }).expect(200);
    return agent;
  }

  function createNotification(overrides: Partial<Parameters<NotificationsService['create']>[0]> = {}) {
    return notificationService.create({
      recipientId: recipient._id.toString(),
      eventId: 'event-1',
      eventType: 'booking.confirmed',
      message: 'Your booking is confirmed.',
      resourceType: 'flight-booking',
      resourceId: '507f1f77bcf86cd799439011',
      ...overrides,
    });
  }

  it('requires an active session', async () => {
    await request(app.getHttpServer()).get('/api/notifications').expect(401);
    await request(app.getHttpServer()).get('/api/notifications/unread-count').expect(401);
  });

  it('returns only the signed-in user’s notifications and an unread count', async () => {
    await createNotification({ eventId: 'recipient-unread' });
    await createNotification({ eventId: 'recipient-read' }).then((n) => notifications.updateOne({ _id: n.id }, { $set: { readAt: new Date() } }));
    await createNotification({ eventId: 'other-user', message: 'Other user only.', recipientId: otherUser._id.toString() });

    const agent = await signIn();
    await agent.get('/api/notifications/unread-count').expect(200, { count: 1 });
    const list = await agent.get('/api/notifications').expect(200);
    expect(list.body.meta).toEqual({ page: 1, limit: 20, total: 2, totalPages: 1 });
    expect(list.body.data).toHaveLength(2);
    expect(list.body.data.map((n: { message: string }) => n.message)).not.toContain('Other user only.');
    expect(list.body.data.map((n: { isRead: boolean }) => n.isRead).sort()).toEqual([false, true]);
    expect(list.headers['cache-control']).toBe('no-store');
  });

  it('paginates and can filter to unread items', async () => {
    await createNotification({ eventId: 'event-1' });
    await createNotification({ eventId: 'event-2' });
    const agent = await signIn();
    const page = await agent.get('/api/notifications?page=2&limit=1&unreadOnly=true').expect(200);
    expect(page.body.meta).toEqual({ page: 2, limit: 1, total: 2, totalPages: 2 });
    expect(page.body.data).toHaveLength(1);
    await agent.get('/api/notifications?unreadOnly=not-a-boolean').expect(400);
    await agent.get('/api/notifications?sortBy=message').expect(400);
  });

  it('marks only an owned notification as read, idempotently', async () => {
    const own = await createNotification();
    const other = await createNotification({ eventId: 'other', recipientId: otherUser._id.toString() });
    const agent = await signIn();

    const first = await agent.patch(`/api/notifications/${own.id}/read`).expect(200);
    expect(first.body.isRead).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const second = await agent.patch(`/api/notifications/${own.id}/read`).expect(200);
    expect(second.body.isRead).toBe(true);
    expect(second.body.readAt).toBe(first.body.readAt);
    await agent.patch(`/api/notifications/${other.id}/read`).expect(404);
    await agent.patch('/api/notifications/not-an-id/read').expect(400);
    await agent.get('/api/notifications/unread-count').expect(200, { count: 0 });
  });

  it('deduplicates redelivery of the same event for the same recipient', async () => {
    const first = await createNotification({ eventId: 'duplicate-event' });
    const duplicate = await createNotification({ eventId: 'duplicate-event', message: 'A retry must not overwrite the original.' });
    expect(duplicate.id).toBe(first.id);
    expect(duplicate.message).toBe(first.message);
    expect(await notifications.countDocuments({ eventId: 'duplicate-event' })).toBe(1);
  });

  it('deduplicates concurrent delivery of the same event', async () => {
    const [first, second] = await Promise.all([
      createNotification({ eventId: 'concurrent-event' }),
      createNotification({ eventId: 'concurrent-event' }),
    ]);
    expect(second.id).toBe(first.id);
    expect(await notifications.countDocuments({ eventId: 'concurrent-event' })).toBe(1);
  });

  it('documents the endpoints in Swagger', async () => {
    const response = await request(app.getHttpServer()).get('/api/docs-json').expect(200);
    expect(response.body.paths['/api/notifications'].get).toBeDefined();
    expect(response.body.paths['/api/notifications/unread-count'].get).toBeDefined();
    expect(response.body.paths['/api/notifications/{id}/read'].patch).toBeDefined();
  });
});
