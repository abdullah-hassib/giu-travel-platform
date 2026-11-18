import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema, Types } from 'mongoose';
import { BookingPolicies } from '../../payments/booking-payment.adapter';

export const FLIGHT_BOOKING_STATUSES = [
  'Pending Payment',
  'Confirmed',
  'Completed',
  'Expired',
  'Cancelled',
] as const;

export type FlightBookingStatus = (typeof FLIGHT_BOOKING_STATUSES)[number];

export const PASSENGER_TYPES = ['Adult', 'Child', 'Infant'] as const;
export type PassengerType = (typeof PASSENGER_TYPES)[number];

@Schema({ _id: false })
export class BookingPassenger {
  @Prop({ type: String, required: true, trim: true, maxlength: 150 })
  fullName!: string;

  @Prop({ type: Date, required: true })
  dateOfBirth!: Date;

  @Prop({ type: String, required: true, enum: PASSENGER_TYPES })
  passengerType!: PassengerType;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  identityDocumentNumber!: string;

  @Prop({ type: Number, required: true, min: 0, validate: Number.isInteger })
  extraBags!: number;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: Number.isSafeInteger,
  })
  extraBaggageFeeMinor!: number;
  @Prop({ type: [Number], default: [] }) extraBagWeightsKg!: number[];
}

export const BookingPassengerSchema =
  SchemaFactory.createForClass(BookingPassenger);

@Schema({ _id: false })
export class BookingSegment {
  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'Flight',
    required: true,
  })
  flightId!: Types.ObjectId;

  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'Airline',
    required: true,
  })
  airlineId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  flightNumber!: string;
  @Prop({ type: String, required: true }) airlineName!: string;
  @Prop({ type: String, required: true }) departureLocalDate!: string;

  @Prop({ type: String, required: true, uppercase: true })
  departureAirportCode!: string;

  @Prop({ type: String, required: true, uppercase: true })
  arrivalAirportCode!: string;

  @Prop({ type: Date, required: true })
  departureAt!: Date;

  @Prop({ type: Date, required: true })
  arrivalAt!: Date;

  @Prop({ type: String, required: true })
  cabinCategory!: string;

  @Prop({ type: Number, required: true, min: 0, validate: Number.isInteger })
  seatsReserved!: number;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: Number.isSafeInteger,
  })
  baseFareMinor!: number;

  @Prop({
    type: Number,
    required: true,
    min: 0,
    validate: Number.isSafeInteger,
  })
  segmentTotalMinor!: number;
}

export const BookingSegmentSchema =
  SchemaFactory.createForClass(BookingSegment);

@Schema({
  collection: 'flight_bookings',
  timestamps: true,
  toJSON: {
    transform: (_document, result: Record<string, unknown>) => {
      const id = result._id;
      if (id) {
        result.id = id.toString();
      }
      delete result._id;
      delete result.__v;
      return result;
    },
  },
})
export class FlightBooking {
  declare _id: Types.ObjectId;
  declare createdAt: Date;
  declare updatedAt: Date;

  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  userId!: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, index: true })
  bookingReference!: string;

  @Prop({
    type: String,
    required: true,
    enum: FLIGHT_BOOKING_STATUSES,
    default: 'Pending Payment',
    index: true,
  })
  status!: FlightBookingStatus;

  @Prop({
    type: [BookingSegmentSchema],
    required: true,
    validate: {
      validator: (segments: BookingSegment[]) =>
        Array.isArray(segments) && segments.length >= 1 && segments.length <= 2,
      message: 'A flight booking must contain one or two flight segments',
    },
  })
  segments!: BookingSegment[];

  @Prop({
    type: [BookingPassengerSchema],
    required: true,
    validate: {
      validator: (passengers: BookingPassenger[]) =>
        Array.isArray(passengers) && passengers.length > 0,
      message: 'A booking must contain at least one passenger',
    },
  })
  passengers!: BookingPassenger[];

  @Prop({
    type: Number,
    required: true,
    min: 1,
    validate: Number.isSafeInteger,
  })
  totalAmountMinor!: number;

  @Prop({ type: String, required: true, uppercase: true, default: 'USD' })
  currency!: string;

  @Prop({ type: Date, required: true })
  holdExpiresAt!: Date;

  @Prop({ type: Date, default: null })
  policiesAcceptedAt?: Date | null;

  @Prop({ type: MongoSchema.Types.Mixed, required: true })
  policySnapshot!: Extract<BookingPolicies, { type: 'flight' }>;
  @Prop({ type: String }) paymentId?: string;
  @Prop({ type: Number, default: 0, select: false }) paymentFence!: number;
  @Prop({ type: Date }) confirmedAt?: Date;
  @Prop({ type: Date }) cancelledAt?: Date;
  @Prop({ type: Number }) refundMinor?: number;
  @Prop({ type: Number }) refundPercent?: number;
}

export type FlightBookingDocument = HydratedDocument<FlightBooking>;

export const FlightBookingSchema = SchemaFactory.createForClass(FlightBooking);

FlightBookingSchema.index({ userId: 1, createdAt: -1 });
FlightBookingSchema.index({ status: 1, holdExpiresAt: 1 });
FlightBookingSchema.index({ 'segments.flightId': 1, status: 1 });
FlightBookingSchema.index({ 'segments.airlineId': 1, status: 1 });
