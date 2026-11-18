import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema } from 'mongoose';
import { randomUUID } from 'node:crypto';

export const OUTBOX_EVENT_TYPES = [
  'hotel_booking.confirmed',
  'hotel_booking.cancelled',
  'hotel.deactivated',
  'hotel.reactivated',
  'moderation.report_dismissed',
  'moderation.content_hidden',
  'moderation.content_deleted',
] as const;
export type OutboxEventType = (typeof OUTBOX_EVENT_TYPES)[number];

/**
 * Events for Omar's audit/notification consumer. They are written in the same
 * transaction as the change they describe, and stay pending until consumed.
 * Same envelope as admin_outbox: deduplicate on `id`, then set status=delivered.
 */
@Schema({ collection: 'event_outbox', timestamps: true })
export class OutboxEvent {
  @Prop({ type: String, required: true, unique: true })
  id!: string;

  @Prop({ type: String, required: true, enum: OUTBOX_EVENT_TYPES })
  type!: OutboxEventType;

  @Prop({ type: Number, required: true, enum: [1] })
  version!: 1;

  @Prop({ type: String, required: true })
  occurredAt!: string;

  @Prop({ type: String, required: true })
  correlationId!: string;

  @Prop({ type: String, default: null })
  actorId!: string | null;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  payload!: Record<string, unknown>;

  @Prop({ type: String, enum: ['pending', 'delivered'], default: 'pending' })
  status!: 'pending' | 'delivered';
}

export const OutboxEventSchema = SchemaFactory.createForClass(OutboxEvent);
OutboxEventSchema.index({ status: 1, occurredAt: 1 });

export function outboxEvent(
  type: OutboxEventType,
  actorId: string | null,
  payload: Record<string, unknown>,
): OutboxEvent {
  const id = randomUUID();
  return {
    id,
    type,
    version: 1,
    occurredAt: new Date().toISOString(),
    correlationId: id,
    actorId,
    payload,
    status: 'pending',
  };
}
