import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DOMAIN_EVENT_PUBLISHER } from '../../common/contracts/domain-events.contract';
import { AuditLoggingModule } from '../audit-logging/audit-logging.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DomainEventConsumer } from './domain-event-consumer';
import { DomainEventPublisherService } from './domain-event-publisher.service';
import { DomainEventOutbox, DomainEventOutboxSchema } from './schemas/domain-event-outbox.schema';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: DomainEventOutbox.name, schema: DomainEventOutboxSchema }]),
    NotificationsModule,
    AuditLoggingModule,
  ],
  providers: [
    DomainEventPublisherService,
    { provide: DOMAIN_EVENT_PUBLISHER, useExisting: DomainEventPublisherService },
    DomainEventConsumer,
  ],
  exports: [DomainEventPublisherService, DOMAIN_EVENT_PUBLISHER],
})
export class DomainEventsModule {}
