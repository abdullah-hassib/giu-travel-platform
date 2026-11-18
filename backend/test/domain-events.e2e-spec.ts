import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server-core';
import { DomainEvent } from '../src/common/contracts/domain-events.contract';
import { AuditLoggingService } from '../src/modules/audit-logging/audit-logging.service';
import { AuditLog } from '../src/modules/audit-logging/schemas/audit-log.schema';
import { DomainEventConsumer } from '../src/modules/domain-events/domain-event-consumer';
import { DomainEventPublisherService as Publisher } from '../src/modules/domain-events/domain-event-publisher.service';
import { DomainEventOutbox } from '../src/modules/domain-events/schemas/domain-event-outbox.schema';
import { Notification } from '../src/modules/notifications/schemas/notification.schema';
import { DomainEventsModule } from '../src/modules/domain-events/domain-events.module';
import { publishEffects } from '../src/modules/domain-events/publish-effects';

@Global()
@Module({
  providers: [{ provide: ConfigService, useValue: new ConfigService({ NODE_ENV: 'test' }) }],
  exports: [ConfigService],
})
class TestConfigurationModule {}

describe('Domain event outbox delivery', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryReplSet;
  let moduleRef: TestingModule;
  let publisher: Publisher;
  let consumer: DomainEventConsumer;
  let auditLogging: AuditLoggingService;
  let outbox: Model<DomainEventOutbox>;
  let notifications: Model<Notification>;
  let auditLogs: Model<AuditLog>;

  beforeAll(async () => {
    server = await MongoMemoryReplSet.create({
      instanceOpts: [{ launchTimeout: 30_000 }],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    moduleRef = await Test.createTestingModule({
      imports: [
        TestConfigurationModule,
        MongooseModule.forRoot(server.getUri(), { dbName: 'giu_domain_event_tests' }),
        DomainEventsModule,
      ],
    }).compile();

    publisher = moduleRef.get(Publisher);
    consumer = moduleRef.get(DomainEventConsumer);
    auditLogging = moduleRef.get(AuditLoggingService);
    outbox = moduleRef.get(getModelToken(DomainEventOutbox.name));
    notifications = moduleRef.get(getModelToken(Notification.name));
    auditLogs = moduleRef.get(getModelToken(AuditLog.name));
    await Promise.all([outbox.init(), notifications.init(), auditLogs.init()]);
  });

  beforeEach(async () => {
    await Promise.all([outbox.deleteMany({}), notifications.deleteMany({}), auditLogs.deleteMany({})]);
  });

  afterAll(async () => {
    await moduleRef?.close();
    await server?.stop();
  });

  function event(id: string): DomainEvent<'flight.schedule_changed'> {
    return {
      id,
      type: 'flight.schedule_changed',
      version: 1,
      occurredAt: '2026-11-18T10:00:00.000Z',
      correlationId: `correlation-${id}`,
      actorId: '507f1f77bcf86cd799439011',
      payload: {
        notifications: [
          {
            recipientId: '507f1f77bcf86cd799439012',
            eventType: 'flight.schedule_changed',
            message: 'Your confirmed flight schedule has changed.',
            resourceType: 'flight',
            resourceId: 'flight-123',
          },
          {
            recipientId: '507f1f77bcf86cd799439013',
            eventType: 'flight.schedule_changed',
            message: 'A confirmed flight schedule has changed.',
            resourceType: 'flight',
            resourceId: 'flight-123',
          },
        ],
        audit: {
          action: 'flight.schedule_changed',
          resourceType: 'flight',
          resourceId: 'flight-123',
          outcome: 'success',
          metadata: { source: 'flight-management', email: 'remove-me@example.com' },
        },
      },
    };
  }

  it('stores events, atomically delivers notifications and audit, and ignores duplicate delivery', async () => {
    const domainEvent = event('event-schedule-changed');
    await publisher.publish(domainEvent);
    expect((await outbox.findOne({ id: domainEvent.id }).orFail()).status).toBe('pending');

    expect(await consumer.consumePending()).toBe(1);
    expect(await notifications.countDocuments({ eventId: domainEvent.id })).toBe(2);
    expect(await auditLogs.countDocuments({ eventId: domainEvent.id })).toBe(1);
    expect((await outbox.findOne({ id: domainEvent.id }).orFail()).status).toBe('delivered');
    expect((await auditLogs.findOne({ eventId: domainEvent.id }).orFail()).metadata?.get('email')).toBeUndefined();

    await publisher.publish(domainEvent);
    expect(await consumer.consumePending()).toBe(0);
    expect(await notifications.countDocuments({ eventId: domainEvent.id })).toBe(2);
    expect(await auditLogs.countDocuments({ eventId: domainEvent.id })).toBe(1);
  });

  it('rolls back all effects on failure and retries the pending event', async () => {
    const domainEvent = event('event-schedule-retry');
    await publisher.publish(domainEvent);
    const append = jest.spyOn(auditLogging, 'append').mockRejectedValueOnce(new Error('temporary database failure'));

    await expect(consumer.consumePending()).rejects.toThrow('temporary database failure');
    expect((await outbox.findOne({ id: domainEvent.id }).orFail()).status).toBe('pending');
    expect(await notifications.countDocuments({ eventId: domainEvent.id })).toBe(0);
    expect(await auditLogs.countDocuments({ eventId: domainEvent.id })).toBe(0);

    append.mockRestore();
    expect(await consumer.consumePending()).toBe(1);
    expect((await outbox.findOne({ id: domainEvent.id }).orFail()).status).toBe('delivered');
    expect(await notifications.countDocuments({ eventId: domainEvent.id })).toBe(2);
    expect(await auditLogs.countDocuments({ eventId: domainEvent.id })).toBe(1);
  });

  it('delivers a provider action to more than one hundred recipients with exactly one audit action', async () => {
    const providerId = new Types.ObjectId().toString();
    await outbox.db.transaction(async (session) => {
      await publishEffects(publisher, session, 'provider.deactivated', new Types.ObjectId().toString(), {
        action: 'provider.deactivated', resourceType: 'airline', resourceId: providerId, outcome: 'success',
      }, Array.from({ length: 101 }, () => ({ recipientId: new Types.ObjectId().toString(), eventType: 'provider.deactivated' as const,
        resourceType: 'airline', resourceId: providerId, message: 'Provider deactivated; existing Confirmed bookings remain valid.',
      })));
    });
    expect(await consumer.consumePending()).toBe(2);
    expect(await notifications.countDocuments({ resourceId: providerId })).toBe(101);
    expect(await auditLogs.countDocuments({ resourceId: providerId })).toBe(1);
    expect(await consumer.consumePending()).toBe(0);
    expect(await notifications.countDocuments({ resourceId: providerId })).toBe(101);
  });
});
