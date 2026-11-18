import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

@Schema({
  collection: 'airports',
  timestamps: true,
  toJSON: {
    transform: (_document, result: Record<string, unknown>) => {
      if (result._id) {
        result.id = result._id.toString();
      }
      delete result._id;
      delete result.__v;
      return result;
    },
  },
})
export class Airport {
  declare createdAt: Date;
  declare updatedAt: Date;

  @Prop({
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    match: /^[A-Z]{3}$/,
  })
  iataCode!: string;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, trim: true })
  cityId!: string;

  @Prop({
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    match: /^[A-Z]{2}$/,
  })
  countryCode!: string;

  @Prop({ type: String, required: true, trim: true })
  timeZone!: string;
}

export type AirportDocument = HydratedDocument<Airport>;

export const AirportSchema = SchemaFactory.createForClass(Airport);

AirportSchema.index({ iataCode: 1 }, { unique: true });
AirportSchema.index({ cityId: 1 });
AirportSchema.index({ countryCode: 1 });
