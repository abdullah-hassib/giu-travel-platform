import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

export const CABIN_CATEGORIES = [
  'Economy',
  'Premium Economy',
  'Business',
  'First',
] as const;

export type CabinCategory = (typeof CABIN_CATEGORIES)[number];

@Schema({ _id: false })
export class FlightCabin {
  @Prop({
    type: String,
    required: true,
    enum: CABIN_CATEGORIES,
  })
  category!: CabinCategory;

  @Prop({ type: Number, required: true, min: 1, validate: Number.isInteger })
  totalSeats!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0, validate: Number.isInteger })
  bookedSeats!: number;

  @Prop({ type: Number, required: true, min: 0, default: 0, validate: Number.isInteger })
  heldSeats!: number;

  // Fare stored in integer USD minor units (cents).
  @Prop({ type: Number, required: true, min: 1, validate: Number.isInteger })
  price!: number;

  @Prop({ type: Number, required: true, min: 0, validate: Number.isInteger })
  freeBags!: number;

  @Prop({ type: Number, required: true, min: 0.01 })
  maxWeightPerBag!: number;
}

export const FlightCabinSchema = SchemaFactory.createForClass(FlightCabin);
