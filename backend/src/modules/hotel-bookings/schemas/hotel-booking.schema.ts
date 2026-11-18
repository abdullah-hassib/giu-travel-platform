import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { FilterQuery, Model, Schema as MongooseSchema, Types } from 'mongoose';
import {
  CancellationTier,
  CancellationTierSchema,
} from '../../hotels/schemas/hotel.schema';
import { NightRange, todayUtc } from '../../hotels/stay-rules';

/** GEN-11 lifecycle, using the same state names as the payment adapter contract. */
export const BOOKING_STATUSES = [
  'Pending Payment',
  'Confirmed',
  'Completed',
  'Cancelled',
  'Expired',
] as const;
export type BookingStatus = (typeof BOOKING_STATUSES)[number];

/** HTL-18: rooms are held this long while the user pays. */
export const HOLD_MINUTES = 10;

@Schema({ _id: false })
export class BookedRoom {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  roomId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  name!: string;

  @Prop({ type: String, required: true })
  type!: string;

  @Prop({ type: Number, required: true, min: 0 })
  adults!: number;

  @Prop({ type: [Number], default: [] })
  childrenAges!: number[];

  // Price at booking time; later room price changes do not affect it (HTL-05).
  @Prop({ type: Number, required: true })
  pricePerNightMinor!: number;

  @Prop({ type: Number, required: true })
  subtotalMinor!: number;
}

const BookedRoomSchema = SchemaFactory.createForClass(BookedRoom);

/** The hotel policies the guest saw and accepted (PAY-02); later edits do not change them. */
@Schema({ _id: false })
export class PolicySnapshot {
  @Prop({ type: String, required: true })
  checkInTime!: string;

  @Prop({ type: String, required: true })
  checkOutTime!: string;

  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers!: CancellationTier[];
}

const PolicySnapshotSchema = SchemaFactory.createForClass(PolicySnapshot);

@Schema({ collection: 'hotel_bookings', timestamps: true })
export class HotelBooking {
  declare _id: Types.ObjectId;
  declare createdAt: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  guestName!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  hotelName!: string;

  // HTL-17: generated when payment confirms the reservation.
  @Prop({ type: String, unique: true, sparse: true })
  reference?: string;

  @Prop({ type: String, enum: BOOKING_STATUSES, required: true })
  status!: BookingStatus;

  @Prop({ type: String, required: true })
  checkIn!: string;

  @Prop({ type: String, required: true })
  checkOut!: string;

  @Prop({ type: Number, required: true, min: 1 })
  nights!: number;

  @Prop({ type: [BookedRoomSchema], required: true })
  rooms!: BookedRoom[];

  @Prop({ type: Number, required: true, min: 1 })
  totalMinor!: number;

  @Prop({ type: String, required: true })
  currency!: string;

  @Prop({ type: Date, required: true })
  holdExpiresAt!: Date;

  @Prop({ type: PolicySnapshotSchema, required: true })
  policies!: PolicySnapshot;

  // Set by the payment service through HotelPaymentAdapter.
  @Prop({ type: String })
  paymentId?: string;

  @Prop({ type: Number, default: 0 })
  paymentFence!: number;

  @Prop({ type: Date })
  confirmedAt?: Date;

  @Prop({ type: Date })
  cancelledAt?: Date;

  @Prop({ type: Number })
  refundPercent?: number;

  @Prop({ type: Number })
  refundMinor?: number;
}

export const HotelBookingSchema = SchemaFactory.createForClass(HotelBooking);
HotelBookingSchema.index({ 'rooms.roomId': 1, checkIn: 1, checkOut: 1 });
HotelBookingSchema.index({ userId: 1, status: 1, checkIn: 1 });
HotelBookingSchema.index({ hotelId: 1, checkIn: -1 });
HotelBookingSchema.index({ status: 1, holdExpiresAt: 1 });

/** Bookings that occupy their rooms during `range`: Confirmed stays and unexpired holds (HTL-18). */
export function occupying(
  range: NightRange,
  now = new Date(),
): FilterQuery<HotelBooking> {
  return {
    checkIn: { $lt: range.to },
    checkOut: { $gt: range.from },
    $or: [
      { status: 'Confirmed' },
      { status: 'Pending Payment', holdExpiresAt: { $gt: now } },
    ],
  };
}

/**
 * Applies the time-based GEN-11 transitions: lapsed holds become Expired and stays
 * whose check-out date has passed become Completed. Called before reading statuses.
 * Expired holds stop blocking rooms on their own (see `occupying`), so this only
 * updates what users see.
 */
export async function refreshBookingStatuses(
  bookings: Model<HotelBooking>,
): Promise<void> {
  const now = new Date();
  await bookings.updateMany(
    { status: 'Pending Payment', holdExpiresAt: { $lte: now } },
    { $set: { status: 'Expired' } },
  );
  await bookings.updateMany(
    { status: 'Confirmed', checkOut: { $lt: todayUtc(now) } },
    { $set: { status: 'Completed' } },
  );
}
