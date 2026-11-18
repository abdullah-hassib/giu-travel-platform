/** Shared contracts for domain event producers and the durable notification/audit outbox. */
export type EntityId = string;
export type BookingKind = 'flight' | 'hotel';
export type BookingState = 'pending' | 'confirmed' | 'cancelled' | 'completed';
export type PaymentState = 'pending' | 'authorized' | 'captured' | 'failed' | 'refunded' | 'partially_refunded';
export type RefundState = 'requested' | 'approved' | 'rejected' | 'processing' | 'completed' | 'failed';
export const DOMAIN_EVENT_TYPES = [
  'account.password_reset',
  'account.suspended',
  'account.reactivated',
  'moderator.created',
  'provider.deactivated',
  'provider.reactivated',
  'flight.schedule_changed',
  'flight.cancelled',
  'booking.confirmed',
  'booking.cancelled',
  'payment.captured',
  'payment.failed',
  'refund.status_changed',
  'content.moderated',
] as const;
export type DomainEventType = (typeof DOMAIN_EVENT_TYPES)[number];

export const NOTIFICATION_EVENT_TYPES = [
  'booking.confirmed',
  'booking.cancelled',
  'flight.schedule_changed',
  'flight.cancelled',
  'refund.status_changed',
  'account.suspended',
  'provider.deactivated',
  'payment.captured',
  'payment.failed',
  'refund.completed',
] as const;
export type NotificationEventType = (typeof NOTIFICATION_EVENT_TYPES)[number];

export interface NotificationIntent {
  recipientId: EntityId;
  eventType: NotificationEventType;
  message: string;
  resourceType: string;
  resourceId: EntityId;
}

export interface AuditIntent {
  action: string;
  resourceType: string;
  resourceId: EntityId;
  outcome: 'success' | 'failure';
  metadata?: Record<string, string | number | boolean | null>;
}

export interface DomainEventEffects {
  notifications?: NotificationIntent[];
  audit?: AuditIntent;
}

export interface DomainEvent<TType extends DomainEventType = DomainEventType> {
  id: EntityId;
  type: TType;
  version: 1;
  occurredAt: string;
  correlationId: string;
  actorId?: EntityId;
  payload: DomainEventEffects;
}
export interface EventPublisher {
  publish<TType extends DomainEventType>(event: DomainEvent<TType>, session?: import('mongoose').ClientSession): Promise<void>;
}
export const DOMAIN_EVENT_PUBLISHER = Symbol('DOMAIN_EVENT_PUBLISHER');
export interface BookingPaymentRequest { bookingId: EntityId; bookingKind: BookingKind; userId: EntityId; amountMinor: number; currency: string; idempotencyKey: string; }
export interface PaymentBookingResult { bookingId: EntityId; paymentId: EntityId; state: PaymentState; correlationId: string; }
export interface AuditRecord { actorId?: EntityId; action: string; entityType: string; entityId: EntityId; occurredAt: string; correlationId: string; outcome: 'success' | 'failure'; metadata?: Record<string, string | number | boolean | null>; }
export interface NotificationEvent { type: NotificationEventType; recipientUserId: EntityId; resourceId: EntityId; correlationId: string; occurredAt: string; }
