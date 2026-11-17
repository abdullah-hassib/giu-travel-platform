import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'payment_events', timestamps: true })
export class PaymentEvent {
  @Prop({ type: String, required: true, unique: true }) eventId!: string;
  @Prop({ type: String, required: true }) type!: string;
  @Prop({ type: String, required: true }) fingerprint!: string;
  @Prop({ type: String, required: true }) occurredAt!: string;
  @Prop({ type: String }) resourceId?: string;
  @Prop({ type: String }) paymentId?: string;
  @Prop({
    type: String,
    enum: ['pending', 'processed', 'ignored'],
    default: 'pending',
  })
  status!: 'pending' | 'processed' | 'ignored';
  @Prop({ type: Date }) processedAt?: Date;
}
export const PaymentEventSchema = SchemaFactory.createForClass(PaymentEvent);
