import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema, Types } from 'mongoose';
import { FlightCabin, FlightCabinSchema } from './flight-cabin.schema';

export const FLIGHT_STATUSES = ['Scheduled', 'Cancelled', 'Departed'] as const;
export type FlightStatus = (typeof FLIGHT_STATUSES)[number];

@Schema({
  collection: 'flights',
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
export class Flight {
  declare _id: Types.ObjectId;
  declare createdAt: Date;
  declare updatedAt: Date;

  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'Airline',
    required: true,
  })
  airlineId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, uppercase: true })
  flightNumber!: string;

  @Prop({
    type: String,
    required: true,
  })
  departureAirportId!: string;

  @Prop({
    type: String,
    required: true,
  })
  arrivalAirportId!: string;

  @Prop({ type: Date, required: true })
  departureAt!: Date;

  @Prop({ type: Date, required: true })
  arrivalAt!: Date;

  // Local departure date at the departure airport, YYYY-MM-DD.
  @Prop({
    type: String,
    required: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
  })
  departureLocalDate!: string;

  @Prop({
    type: String,
    enum: FLIGHT_STATUSES,
    default: 'Scheduled',
    required: true,
  })
  status!: FlightStatus;

  @Prop({
    type: [FlightCabinSchema],
    required: true,
    validate: {
      validator: (cabins: FlightCabin[]) => {
        if (!Array.isArray(cabins) || cabins.length === 0) {
          return false;
        }

        const categories = cabins.map((cabin) => cabin.category);
        return new Set(categories).size === categories.length;
      },
      message: 'Each cabin category can appear only once per flight',
    },
  })
  cabins!: FlightCabin[];
}

export type FlightDocument = HydratedDocument<Flight>;

export const FlightSchema = SchemaFactory.createForClass(Flight);

FlightSchema.index(
  { airlineId: 1, flightNumber: 1, departureLocalDate: 1 },
  { unique: true },
);

FlightSchema.index({ status: 1, departureAt: 1 });
FlightSchema.index({
  departureAirportId: 1,
  arrivalAirportId: 1,
  departureAt: 1,
});
FlightSchema.index({ airlineId: 1, departureAt: 1 });
FlightSchema.index({
  departureAirportId: 1,
  arrivalAirportId: 1,
  departureLocalDate: 1,
  status: 1,
  departureAt: 1,
});
