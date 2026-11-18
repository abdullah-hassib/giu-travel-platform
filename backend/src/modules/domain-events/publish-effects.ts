import { randomUUID } from 'node:crypto';
import { ClientSession } from 'mongoose';
import {
  AuditIntent,
  DomainEventType,
  NotificationIntent,
} from '../../common/contracts/domain-events.contract';
import { DomainEventPublisherService } from './domain-event-publisher.service';

/** One audit action; arbitrarily many recipients in bounded transactional envelopes. */
export async function publishEffects(
  publisher: DomainEventPublisherService,
  session: ClientSession,
  type: DomainEventType,
  actorId: string | undefined,
  audit: AuditIntent | undefined,
  notifications: NotificationIntent[] = [],
): Promise<void> {
  const id = randomUUID();
  const occurredAt = new Date().toISOString();
  for (
    let offset = 0;
    offset < Math.max(notifications.length, 1);
    offset += 100
  ) {
    await publisher.publish(
      {
        id: offset === 0 ? id : `${id}:${offset / 100}`,
        type,
        version: 1,
        actorId,
        occurredAt,
        correlationId: id,
        payload: {
          ...(offset === 0 && audit ? { audit } : {}),
          notifications: notifications.slice(offset, offset + 100),
        },
      },
      session,
    );
  }
}
