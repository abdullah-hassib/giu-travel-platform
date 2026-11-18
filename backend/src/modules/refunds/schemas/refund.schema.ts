import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  BookingKind,
  BOOKING_KINDS,
} from '../../payments/booking-payment.adapter';

@Schema({ collection: 'refunds', timestamps: true })
export class Refund {
  declare _id: Types.ObjectId;
  @Prop({ type: String, unique: true, required: true }) operationKey!: string;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  paymentId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  bookingId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;
  @Prop({ type: String, enum: BOOKING_KINDS, required: true })
  kind!: BookingKind;
  @Prop({ type: String, required: true }) stripeIntentId!: string;
  @Prop({ type: Number, required: true }) paidAmountMinor!: number;
  @Prop({ type: Number, required: true }) amountMinor!: number;
  @Prop({ type: String, enum: ['USD'], required: true }) currency!: string;
  @Prop({
    type: String,
    enum: ['user_cancellation', 'provider_cancellation', 'late_payment'],
    required: true,
  })
  reason!: 'user_cancellation' | 'provider_cancellation' | 'late_payment';
  @Prop({ type: String, unique: true, sparse: true }) stripeRefundId?: string;
  @Prop({
    type: String,
    enum: ['Pending', 'Refunded', 'Failed'],
    default: 'Pending',
  })
  status!: 'Pending' | 'Refunded' | 'Failed';
  @Prop({ type: Date, default: Date.now }) nextAttemptAt!: Date;
  @Prop({ type: String, select: false }) leaseToken?: string;
  @Prop({ type: Date, select: false }) leaseUntil?: Date;
}
export type RefundDocument = HydratedDocument<Refund>;
export const RefundSchema = SchemaFactory.createForClass(Refund);
RefundSchema.index({ status: 1, nextAttemptAt: 1 });
