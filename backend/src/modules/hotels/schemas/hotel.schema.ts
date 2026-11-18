import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Types } from 'mongoose';
import {
  CITY_IDS,
  COUNTRY_CODES,
} from '../../reference-data/official-reference';
import {
  StoredImage,
  StoredImageSchema,
} from '../../media-uploads/stored-image.schema';

@Schema({ _id: false })
export class CancellationTier {
  @Prop({ type: Number, required: true, min: 0 })
  daysBefore!: number;

  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercent!: number;
}

export const CancellationTierSchema =
  SchemaFactory.createForClass(CancellationTier);

@Schema({ collection: 'hotels', timestamps: true })
export class Hotel {
  declare _id: Types.ObjectId;
  declare createdAt: Date;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, default: '' })
  description!: string;

  @Prop({ type: String, required: true, trim: true })
  address!: string;

  @Prop({ type: String, enum: CITY_IDS, required: true })
  cityId!: string;

  @Prop({ type: String, enum: COUNTRY_CODES, required: true })
  countryCode!: string;

  @Prop({ type: Number, required: true, min: 1, max: 5 })
  starRating!: number;

  @Prop({ type: [String], default: [] })
  amenities!: string[];

  @Prop({ type: [StoredImageSchema], default: [] })
  images!: StoredImage[];

  // HTL-09: standard times, shown on the hotel page and the booking summary.
  @Prop({ type: String, default: '14:00' })
  checkInTime!: string;

  @Prop({ type: String, default: '12:00' })
  checkOutTime!: string;

  // HTL-10: refund tiers by days before check-in.
  @Prop({ type: [CancellationTierSchema], default: [] })
  cancellationTiers!: CancellationTier[];

  // ACC-15: a deactivated hotel is hidden from search and cannot be booked.
  @Prop({ type: Boolean, default: true })
  active!: boolean;

  // HTL-23: running totals so the average can be updated atomically with each review.
  @Prop({ type: Number, default: 0 })
  ratingSum!: number;

  @Prop({ type: Number, default: 0 })
  ratingCount!: number;
}

export const HotelSchema = SchemaFactory.createForClass(Hotel);
HotelSchema.index({ cityId: 1, active: 1 });
HotelSchema.index({ countryCode: 1, active: 1 });

export function averageRating(
  hotel: Pick<Hotel, 'ratingSum' | 'ratingCount'>,
): number | null {
  if (hotel.ratingCount <= 0) return null;
  return Math.round((hotel.ratingSum / hotel.ratingCount) * 10) / 10;
}
