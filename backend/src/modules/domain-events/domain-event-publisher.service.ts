import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import {
  DOMAIN_EVENT_TYPES,
  DomainEvent,
  DomainEventType,
  EventPublisher,
  NOTIFICATION_EVENT_TYPES,
} from '../../common/contracts/domain-events.contract';
import { DomainEventOutbox } from './schemas/domain-event-outbox.schema';

const SENSITIVE_METADATA_KEY = /(password|token|secret|credential|card|email|phone|address|full.?name)/i;

@Injectable()
export class DomainEventPublisherService implements EventPublisher {
  constructor(@InjectModel(DomainEventOutbox.name) private readonly outbox: Model<DomainEventOutbox>) {}

  async publish<TType extends DomainEventType>(event: DomainEvent<TType>, session?: ClientSession): Promise<void> {
    this.validate(event);
    const payload = {
      ...event.payload,
      ...(event.payload.audit?.metadata
        ? { audit: { ...event.payload.audit, metadata: this.sanitizeMetadata(event.payload.audit.metadata) } }
        : {}),
    };

    await this.outbox.findOneAndUpdate(
      { id: event.id },
      {
        $setOnInsert: {
          id: event.id,
          type: event.type,
          version: event.version,
          occurredAt: event.occurredAt,
          correlationId: event.correlationId,
          actorId: event.actorId ?? null,
          payload,
          status: 'pending',
          deliveredAt: null,
        },
      },
      { upsert: true, new: true, runValidators: true, ...(session ? { session } : {}) },
    ).exec();
  }

  private validate(event: DomainEvent): void {
    if (!event || typeof event !== 'object') throw new BadRequestException('Domain event is required');
    if (!DOMAIN_EVENT_TYPES.includes(event.type)) throw new BadRequestException('Unsupported domain event type');
    if (typeof event.id !== 'string' || event.id.trim().length === 0 || event.id.length > 128) {
      throw new BadRequestException('Domain event ID must be between 1 and 128 characters');
    }
    if (event.version !== 1) throw new BadRequestException('Unsupported domain event version');
    if (typeof event.correlationId !== 'string' || event.correlationId.trim().length === 0 || event.correlationId.length > 128) {
      throw new BadRequestException('Domain event correlation ID must be between 1 and 128 characters');
    }
    if (typeof event.occurredAt !== 'string' || !Number.isFinite(Date.parse(event.occurredAt))) {
      throw new BadRequestException('Domain event occurredAt must be a valid date-time string');
    }
    if (!event.payload || typeof event.payload !== 'object') throw new BadRequestException('Domain event payload is required');
    const notifications = event.payload.notifications ?? [];
    const audit = event.payload.audit;
    if (!Array.isArray(notifications)) throw new BadRequestException('Domain event notifications must be an array');
    if (notifications.length > 100) throw new BadRequestException('A domain event may notify at most 100 recipients');
    if (notifications.length === 0 && !audit) throw new BadRequestException('Domain event must contain a notification or audit effect');
    for (const intent of notifications) {
      if (!intent || !/^[a-f\d]{24}$/i.test(intent.recipientId) || !NOTIFICATION_EVENT_TYPES.includes(intent.eventType)
        || typeof intent.message !== 'string' || !intent.message.trim()
        || typeof intent.resourceType !== 'string' || !/^[a-z][a-z0-9-]*$/.test(intent.resourceType)
        || typeof intent.resourceId !== 'string' || !intent.resourceId.trim()) {
        throw new BadRequestException('Notification event effects must include recipient, type, message, and resource');
      }
      if (intent.message.length > 500 || intent.resourceType.length > 80 || intent.resourceId.length > 128) {
        throw new BadRequestException('Notification event effect exceeds the supported field length');
      }
    }
    if (audit && (typeof audit.action !== 'string' || !audit.action.trim() || audit.action.length > 100
      || typeof audit.resourceType !== 'string' || !/^[a-z][a-z0-9-]*$/.test(audit.resourceType)
      || typeof audit.resourceId !== 'string' || !audit.resourceId.trim() || audit.resourceId.length > 128
      || !['success', 'failure'].includes(audit.outcome))) {
      throw new BadRequestException('Audit event effects must include action, resource, and outcome');
    }
  }

  private sanitizeMetadata(metadata: NonNullable<DomainEvent['payload']['audit']>['metadata']) {
    if (!metadata) return undefined;
    const sanitized: Record<string, string | number | boolean | null> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (SENSITIVE_METADATA_KEY.test(key) || !/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) continue;
      if (typeof value === 'string') sanitized[key] = value.slice(0, 250);
      else if (typeof value === 'number' && Number.isFinite(value)) sanitized[key] = value;
      else if (typeof value === 'boolean' || value === null) sanitized[key] = value;
    }
    return Object.keys(sanitized).length ? sanitized : undefined;
  }
}
