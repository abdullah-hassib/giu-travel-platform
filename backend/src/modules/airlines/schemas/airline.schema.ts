import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema, Types } from 'mongoose';

export const AIRLINE_STATUSES = ['active', 'deactivated'] as const;
export type AirlineStatus = (typeof AIRLINE_STATUSES)[number];

@Schema({ _id: false })
export class BaggagePolicy {
  @Prop({ type: Number, required: true, min: 0.01 })
  extraBagPrice!: number;

  @Prop({ type: Number, required: true, min: 0 })
  maxExtraBags!: number;
}

export const BaggagePolicySchema =
  SchemaFactory.createForClass(BaggagePolicy);


@Schema({ _id: false })
export class CancellationPolicyTier {
  @Prop({ type: Number, required: true, min: 0 })
  daysBeforeDeparture!: number;

  @Prop({ type: Number, required: true, min: 0, max: 100 })
  refundPercentage!: number;
}

export const CancellationPolicyTierSchema =
  SchemaFactory.createForClass(CancellationPolicyTier);

@Schema({
  collection: 'airlines',
  timestamps: true,
  toJSON: {
    transform: (_document, result: Record<string, unknown>) => {
      const id = result._id;
      if (id) {
        result.id = id.toString();
      }
      delete result._id;
      delete result.__v;
      delete result.moderatorId;
      return result;
    },
  },
})
export class Airline {
  declare _id: Types.ObjectId;
  declare createdAt: Date;
  declare updatedAt: Date;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  name!: string;

  @Prop({
    type: String,
    required: true,
    uppercase: true,
    trim: true,
    maxlength: 10,
  })
  code!: string;

  @Prop({ type: String, required: true, trim: true })
  logoUrl!: string;

  @Prop({
    type: MongoSchema.Types.ObjectId,
    ref: 'User',
    required: true,
  })
  moderatorId!: Types.ObjectId;

  @Prop({
    type: String,
    enum: AIRLINE_STATUSES,
    default: 'active',
    required: true,
  })
  status!: AirlineStatus;

  @Prop({ type: BaggagePolicySchema, required: false })
  baggagePolicy?: BaggagePolicy;

  @Prop({ type: [CancellationPolicyTierSchema], default: [] })
  cancellationPolicy!: CancellationPolicyTier[];
}

export type AirlineDocument = HydratedDocument<Airline>;

export const AirlineSchema = SchemaFactory.createForClass(Airline);

AirlineSchema.index({ code: 1 }, { unique: true });
AirlineSchema.index({ moderatorId: 1 }, { unique: true });
AirlineSchema.index({ status: 1 });

