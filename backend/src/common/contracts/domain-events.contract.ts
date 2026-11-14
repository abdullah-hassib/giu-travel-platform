/** Proposed cross-module interfaces. They are not wired or persisted yet. */
export type EntityId = string;
export type BookingKind = 'flight' | 'hotel';
export type BookingState = 'pending' | 'confirmed' | 'cancelled' | 'completed';
export type PaymentState = 'pending' | 'authorized' | 'captured' | 'failed' | 'refunded' | 'partially_refunded';
export type RefundState = 'requested' | 'approved' | 'rejected' | 'processing' | 'completed' | 'failed';
export type NotificationEventType = 'booking.confirmed' | 'booking.cancelled' | 'payment.captured' | 'payment.failed' | 'refund.completed';
export interface DomainEvent<TPayload = Record<string, unknown>> {
  id: EntityId;
  type: string;
  version: 1;
  occurredAt: string;
  correlationId: string;
  actorId?: EntityId;
  payload: TPayload;
}
export interface EventPublisher { publish<TPayload>(event: DomainEvent<TPayload>): Promise<void>; }
export interface BookingPaymentRequest { bookingId: EntityId; bookingKind: BookingKind; userId: EntityId; amountMinor: number; currency: string; idempotencyKey: string; }
export interface PaymentBookingResult { bookingId: EntityId; paymentId: EntityId; state: PaymentState; correlationId: string; }
export interface AuditRecord { actorId?: EntityId; action: string; entityType: string; entityId: EntityId; occurredAt: string; correlationId: string; outcome: 'success' | 'failure'; metadata?: Record<string, string | number | boolean | null>; }
export interface NotificationEvent { type: NotificationEventType; recipientUserId: EntityId; resourceId: EntityId; correlationId: string; occurredAt: string; }
