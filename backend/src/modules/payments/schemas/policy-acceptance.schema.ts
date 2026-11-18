import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongooseSchema, Types } from 'mongoose';
import {
  BOOKING_KINDS,
  BookingKind,
  BookingPolicies,
} from '../booking-payment.adapter';
import { PLATFORM_CURRENCY } from '../platform-money';

@Schema({ collection: 'booking_policy_acceptances', timestamps: true })
export class PolicyAcceptance {
  declare _id: Types.ObjectId;
  @Prop({ type: String, enum: BOOKING_KINDS, required: true })
  kind!: BookingKind;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  bookingId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  providerId!: Types.ObjectId;
  @Prop({ type: String, required: true }) bookingRevision!: string;
  @Prop({ type: String, required: true }) policyToken!: string;
  @Prop({ type: Number, required: true }) amountMinor!: number;
  @Prop({ type: String, enum: [PLATFORM_CURRENCY], required: true })
  currency!: string;
  // Only the service's validated positive policy projection is written here.
  @Prop({ type: MongooseSchema.Types.Mixed, required: true })
  policies!: BookingPolicies;
  @Prop({ type: Date, required: true }) holdExpiresAt!: Date;
  @Prop({ type: Date, required: true }) acceptedAt!: Date;
}

export type PolicyAcceptanceDocument = HydratedDocument<PolicyAcceptance>;
export const PolicyAcceptanceSchema =
  SchemaFactory.createForClass(PolicyAcceptance);
PolicyAcceptanceSchema.index({ kind: 1, bookingId: 1 }, { unique: true });
