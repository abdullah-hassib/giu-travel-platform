import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Schema as MongoSchema, Types } from 'mongoose';
import { CITY_IDS, COUNTRY_CODES, CURRENCIES } from '../reference-data';
import {
  BUDGET_CATEGORIES,
  BudgetCategory,
} from '../../budgeting/budgeting.constants';

@Schema({ _id: false })
export class ActivityCost {
  @Prop({ type: Number, required: true, min: 0 })
  amountMinor!: number;

  @Prop({ type: String, enum: CURRENCIES, required: true })
  currency!: string;
}

@Schema()
export class BudgetEntry extends ActivityCost {
  declare _id: Types.ObjectId;

  @Prop({ type: String, enum: BUDGET_CATEGORIES, required: true })
  category!: BudgetCategory;
}

@Schema()
export class TransportEntry extends ActivityCost {
  declare _id: Types.ObjectId;

  @Prop({ type: String, enum: CITY_IDS, required: true })
  fromCityId!: string;

  @Prop({ type: String, enum: CITY_IDS, required: true })
  toCityId!: string;

  @Prop({ type: String, required: true, trim: true })
  mode!: string;
}

@Schema()
export class ItineraryActivity {
  declare _id: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, default: '' })
  description!: string;

  @Prop({ type: String })
  time?: string;

  @Prop({ type: ActivityCost })
  cost?: ActivityCost;
}

@Schema()
export class ItineraryDay {
  declare _id: Types.ObjectId;

  @Prop({ type: String, enum: CITY_IDS, required: true })
  cityId!: string;

  @Prop({ type: String, default: '' })
  notes!: string;

  @Prop({
    type: [SchemaFactory.createForClass(ItineraryActivity)],
    default: [],
  })
  activities!: ItineraryActivity[];

  @Prop({ type: [SchemaFactory.createForClass(BudgetEntry)], default: [] })
  budgets!: BudgetEntry[];

  @Prop({ type: [SchemaFactory.createForClass(TransportEntry)], default: [] })
  transportCosts!: TransportEntry[];
}

@Schema({ _id: false })
export class CloneAttribution {
  @Prop({ type: MongoSchema.Types.ObjectId, required: true })
  itineraryId!: Types.ObjectId;

  @Prop({ type: MongoSchema.Types.ObjectId, required: true })
  authorId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  authorName!: string;
}

@Schema({
  collection: 'itineraries',
  timestamps: true,
  optimisticConcurrency: true,
})
export class Itinerary {
  declare _id: Types.ObjectId;
  declare createdAt: Date;
  declare updatedAt: Date;
  declare __v: number;

  @Prop({ type: MongoSchema.Types.ObjectId, required: true, ref: 'User' })
  ownerId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 100 })
  title!: string;

  @Prop({ type: [String], enum: COUNTRY_CODES, required: true })
  countryCodes!: string[];

  @Prop({ type: String, required: true })
  startDate!: string;

  @Prop({ type: String, enum: ['private', 'public'], default: 'private' })
  visibility!: 'private' | 'public';

  @Prop({
    type: [SchemaFactory.createForClass(ItineraryDay)],
    default: [],
    validate: {
      validator: (days: ItineraryDay[]) => days.length <= 60,
      message: 'Maximum sixty days',
    },
  })
  days!: ItineraryDay[];

  @Prop({ type: CloneAttribution })
  clonedFrom?: CloneAttribution;
}

export type ItineraryDocument = HydratedDocument<Itinerary>;
export const ItinerarySchema = SchemaFactory.createForClass(Itinerary);
ItinerarySchema.index({ ownerId: 1, updatedAt: -1, _id: -1 });
ItinerarySchema.index({ visibility: 1, updatedAt: -1, _id: -1 });
