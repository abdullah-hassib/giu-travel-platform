import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { CreateNotificationDto } from '../notifications/dto/notifications.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { AuditLoggingService } from '../audit-logging/audit-logging.service';
import { DomainEventOutbox } from './schemas/domain-event-outbox.schema';

const POLL_INTERVAL_MS = 5_000;
const MAX_EVENTS_PER_POLL = 50;

@Injectable()
export class DomainEventConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DomainEventConsumer.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectModel(DomainEventOutbox.name) private readonly outbox: Model<DomainEventOutbox>,
    @InjectConnection() private readonly connection: Connection,
    private readonly notifications: NotificationsService,
    private readonly auditLogging: AuditLoggingService,
    @Optional() private readonly config?: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config?.get<string>('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => void this.poll(), POLL_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async consumePending(): Promise<number> {
    let consumed = 0;
    for (let index = 0; index < MAX_EVENTS_PER_POLL; index += 1) {
      let processedThisTransaction = false;
      await this.connection.transaction(async (session) => {
        processedThisTransaction = false;
        const event = await this.outbox.findOneAndUpdate(
          { status: 'pending' },
          { $set: { status: 'delivered', deliveredAt: new Date() } },
          { new: true, sort: { occurredAt: 1, _id: 1 }, session },
        ).exec();
        if (!event) return;

        for (const intent of event.payload.notifications ?? []) {
          const input: CreateNotificationDto = {
            eventId: event.id,
            eventType: intent.eventType,
            message: intent.message,
            resourceType: intent.resourceType,
            resourceId: intent.resourceId,
            recipientId: intent.recipientId,
          };
          await this.notifications.create(input, session);
        }

        if (event.payload.audit) {
          await this.auditLogging.append({
            eventId: event.id,
            actorId: event.actorId,
            action: event.payload.audit.action,
            resourceType: event.payload.audit.resourceType,
            resourceId: event.payload.audit.resourceId,
            occurredAt: new Date(event.occurredAt),
            correlationId: event.correlationId,
            outcome: event.payload.audit.outcome,
            metadata: event.payload.audit.metadata,
          }, session);
        }
        processedThisTransaction = true;
      });

      if (!processedThisTransaction) break;
      consumed += 1;
    }
    return consumed;
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.consumePending();
    } catch {
      // The transaction leaves the event pending, so the next poll retries it.
      this.logger.warn('Domain event processing failed; pending events will be retried');
    } finally {
      this.running = false;
    }
  }
}
