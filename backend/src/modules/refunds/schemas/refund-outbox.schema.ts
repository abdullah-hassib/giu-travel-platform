import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ _id: false })
export class RefundStatusPayload {
  @Prop({ type: String, required: true }) recipientUserId!: string;
  @Prop({ type: String, required: true }) refundId!: string;
  @Prop({ type: String, required: true }) paymentId!: string;
  @Prop({ type: String, required: true }) bookingId!: string;
  @Prop({ type: String, enum: ['flight', 'hotel'], required: true })
  bookingType!: string;
  @Prop({ type: Number, required: true }) amountMinor!: number;
  @Prop({ type: String, enum: ['USD'], required: true }) currency!: string;
  @Prop({
    type: String,
    enum: ['Pending', 'Refunded', 'Failed'],
    required: true,
  })
  refundStatus!: string;
}

@Schema({ collection: 'refund_outbox', timestamps: true })
export class RefundOutbox {
  @Prop({ type: String, unique: true, required: true }) id!: string;
  @Prop({
    type: String,
    enum: ['refund.status_changed'],
    default: 'refund.status_changed',
  })
  type!: 'refund.status_changed';
  @Prop({ type: Number, enum: [1], default: 1 }) version!: 1;
  @Prop({ type: String, required: true }) occurredAt!: string;
  @Prop({ type: String, required: true }) correlationId!: string;
  @Prop({ type: RefundStatusPayload, required: true })
  payload!: RefundStatusPayload;
  @Prop({ type: String, enum: ['pending', 'delivered'], default: 'pending' })
  status!: 'pending' | 'delivered';
}
export const RefundOutboxSchema = SchemaFactory.createForClass(RefundOutbox);
RefundOutboxSchema.index({ status: 1, occurredAt: 1 });
