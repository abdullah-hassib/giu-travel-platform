import { Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { AdminOutboxEvent } from '../administration/schemas/admin-outbox.schema';
import { AuditLoggingService } from './audit-logging.service';
import { NotificationsService } from '../notifications/notifications.service';

const POLL_INTERVAL_MS = 5_000;
const MAX_EVENTS_PER_POLL = 50;

@Injectable()
export class AdminOutboxConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AdminOutboxConsumer.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectModel(AdminOutboxEvent.name) private readonly outbox: Model<AdminOutboxEvent>,
    @InjectConnection() private readonly connection: Connection,
    private readonly auditLogging: AuditLoggingService,
    private readonly notifications: NotificationsService,
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
          { status: 'pending', version: 1, type: { $in: ['account.password_reset', 'moderator.created', 'account.suspended', 'account.reactivated'] } },
          { $set: { status: 'delivered' } },
          { new: true, sort: { occurredAt: 1 }, session },
        ).exec();
        if (!event) return;

        await this.auditLogging.append({
          eventId: event.id,
          actorId: event.actorId,
          action: event.type,
          resourceType: 'account',
          resourceId: event.payload.targetUserId,
          occurredAt: new Date(event.occurredAt),
          correlationId: event.correlationId,
          outcome: 'success',
          metadata: { eventVersion: event.version },
        }, session);
        if (event.type === 'account.suspended') {
          await this.notifications.create({
            eventId: event.id,
            eventType: event.type,
            recipientId: event.payload.targetUserId,
            resourceType: 'account',
            resourceId: event.payload.targetUserId,
            message: 'Your account has been suspended. Contact an administrator for assistance.',
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
      this.logger.warn('Admin outbox processing failed; pending events will be retried');
    } finally {
      this.running = false;
    }
  }
}
