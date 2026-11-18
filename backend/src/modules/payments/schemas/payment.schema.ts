import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  BOOKING_KINDS,
  BookingKind,
  BookingPolicies,
} from '../booking-payment.adapter';

import { STRIPE_INTENT_STATUSES } from '../stripe-intent-status';

export const PAYMENT_STATUSES = [
  'creating',
  ...STRIPE_INTENT_STATUSES,
] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

@Schema({ collection: 'payments', timestamps: true })
export class Payment {
  declare _id: Types.ObjectId;
  @Prop({ type: String, enum: BOOKING_KINDS, required: true })
  kind!: BookingKind;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  bookingId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  providerId!: Types.ObjectId;
  @Prop({ type: Number, required: true }) amountMinor!: number;
  @Prop({ type: String, enum: ['USD'], required: true }) currency!: string;
  @Prop({ type: String, required: true }) bookingRevision!: string;
  @Prop({ type: String, required: true }) policyToken!: string;
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  policies!: BookingPolicies;
  @Prop({ type: Date, required: true }) acceptedAt!: Date;
  @Prop({ type: Date, required: true }) holdExpiresAt!: Date;
  @Prop({ type: String, unique: true, sparse: true }) stripeIntentId?: string;
  @Prop({ type: String, enum: PAYMENT_STATUSES, default: 'creating' })
  status!: PaymentStatus;
  @Prop({
    type: String,
    enum: ['pending', 'confirmed', 'expired'],
    default: 'pending',
  })
  fulfillment!: 'pending' | 'confirmed' | 'expired';
  @Prop({ type: Date }) nextAttemptAt?: Date;
  @Prop({ type: Date }) expiryResolvedAt?: Date;
  @Prop({ type: String, select: false }) leaseToken?: string;
  @Prop({ type: Date, select: false }) leaseUntil?: Date;
  @Prop({ type: Number, default: 0, select: false }) refundFence!: number;
}

export type PaymentDocument = HydratedDocument<Payment>;
export const PaymentSchema = SchemaFactory.createForClass(Payment);
PaymentSchema.index({ kind: 1, bookingId: 1 }, { unique: true });
PaymentSchema.index({ fulfillment: 1, holdExpiresAt: 1, nextAttemptAt: 1 });
