import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import { DOMAIN_EVENT_TYPES, DomainEvent, DomainEventType } from '../../../common/contracts/domain-events.contract';

@Schema({ collection: 'domain_event_outbox', timestamps: true, versionKey: false })
export class DomainEventOutbox {
  declare _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, immutable: true, maxlength: 128 })
  id!: string;

  @Prop({ type: String, required: true, enum: DOMAIN_EVENT_TYPES, immutable: true })
  type!: DomainEventType;

  @Prop({ type: Number, required: true, enum: [1], immutable: true })
  version!: 1;

  @Prop({ type: String, required: true, immutable: true })
  occurredAt!: string;

  @Prop({ type: String, required: true, immutable: true, maxlength: 128 })
  correlationId!: string;

  @Prop({ type: String, default: null, immutable: true, maxlength: 128 })
  actorId!: string | null;

  @Prop({ type: MongooseSchema.Types.Mixed, required: true, immutable: true })
  payload!: DomainEvent['payload'];

  @Prop({ type: String, required: true, enum: ['pending', 'delivered'], default: 'pending' })
  status!: 'pending' | 'delivered';

  @Prop({ type: Date, default: null })
  deliveredAt!: Date | null;
}

export type DomainEventOutboxDocument = HydratedDocument<DomainEventOutbox>;
export const DomainEventOutboxSchema = SchemaFactory.createForClass(DomainEventOutbox);
DomainEventOutboxSchema.index({ status: 1, occurredAt: 1, _id: 1 });
