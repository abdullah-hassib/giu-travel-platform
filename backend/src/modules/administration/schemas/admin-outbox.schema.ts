import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
class AccountEventPayload {
  @Prop({ type: String, required: true })
  targetUserId!: string;
}

@Schema({ collection: 'admin_outbox', timestamps: true })
export class AdminOutboxEvent {
  @Prop({ type: String, required: true, unique: true })
  id!: string;

  @Prop({ type: String, required: true, enum: ['account.password_reset'] })
  type!: 'account.password_reset';

  @Prop({ type: Number, required: true, enum: [1] })
  version!: 1;

  @Prop({ type: String, required: true })
  occurredAt!: string;

  @Prop({ type: String, required: true })
  correlationId!: string;

  @Prop({ type: String, required: true })
  actorId!: string;

  @Prop({ type: AccountEventPayload, required: true })
  payload!: AccountEventPayload;

  @Prop({ type: String, enum: ['pending', 'delivered'], default: 'pending' })
  status!: 'pending' | 'delivered';
}

export const AdminOutboxEventSchema = SchemaFactory.createForClass(AdminOutboxEvent);
AdminOutboxEventSchema.index({ status: 1, occurredAt: 1 });
