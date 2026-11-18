import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';

/** HTL-23: one rating and optional review per Completed reservation. */
@Schema({ collection: 'hotel_reviews', timestamps: true })
export class Review {
  declare _id: Types.ObjectId;
  declare createdAt: Date;
  declare updatedAt: Date;

  // Unique: the database itself guarantees one review per reservation.
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'HotelBooking',
    required: true,
    unique: true,
  })
  bookingId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;

  @Prop({ type: Number, required: true, min: 1, max: 5 })
  rating!: number;

  @Prop({ type: String, default: '', maxlength: 1000 })
  comment!: string;

  // GEN-10: hidden reviews are left out of listings and the hotel's average.
  @Prop({ type: Boolean, default: false })
  hidden!: boolean;
}

export const ReviewSchema = SchemaFactory.createForClass(Review);
ReviewSchema.index({ hotelId: 1, hidden: 1, createdAt: -1 });
