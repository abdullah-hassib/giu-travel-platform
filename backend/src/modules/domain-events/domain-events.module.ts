import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { DOMAIN_EVENT_PUBLISHER } from '../../common/contracts/domain-events.contract';
import { AuditLoggingModule } from '../audit-logging/audit-logging.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DomainEventConsumer } from './domain-event-consumer';
import { DomainEventPublisherService } from './domain-event-publisher.service';
import { DomainEventOutbox, DomainEventOutboxSchema } from './schemas/domain-event-outbox.schema';
import { CommittedOutboxConsumer } from './committed-outbox-consumer';
import { OutboxEvent, OutboxEventSchema } from '../../common/events/outbox-event.schema';
import { RefundOutbox, RefundOutboxSchema } from '../refunds/schemas/refund-outbox.schema';
import { HotelBooking, HotelBookingSchema } from '../hotel-bookings/schemas/hotel-booking.schema';
import { ModeratorAssignment, ModeratorAssignmentSchema } from '../administration/schemas/moderator-assignment.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: DomainEventOutbox.name, schema: DomainEventOutboxSchema },
      { name: OutboxEvent.name, schema: OutboxEventSchema },
      { name: RefundOutbox.name, schema: RefundOutboxSchema },
      { name: HotelBooking.name, schema: HotelBookingSchema },
      { name: ModeratorAssignment.name, schema: ModeratorAssignmentSchema },
    ]),
    NotificationsModule,
    AuditLoggingModule,
  ],
  providers: [
    DomainEventPublisherService,
    { provide: DOMAIN_EVENT_PUBLISHER, useExisting: DomainEventPublisherService },
    DomainEventConsumer,
    CommittedOutboxConsumer,
  ],
  exports: [DomainEventPublisherService, DOMAIN_EVENT_PUBLISHER],
})
export class DomainEventsModule {}
