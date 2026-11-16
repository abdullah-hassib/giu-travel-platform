import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

@Schema({ collection: 'itinerary_fx_rates', versionKey: false })
export class FxRateCache {
  // One successful snapshot per UTC day, shared across server processes.
  @Prop({ type: String, required: true })
  _id!: string;

  @Prop({ type: String, enum: ['fetching', 'ready', 'failed'], required: true })
  status!: 'fetching' | 'ready' | 'failed';

  @Prop({ type: Date, default: Date.now })
  requestedAt!: Date;

  @Prop({ type: String })
  attemptId?: string;

  @Prop({ type: String })
  rateDate?: string;

  @Prop({ type: Map, of: Number })
  rates?: Map<string, number>;

  @Prop({ type: Date })
  fetchedAt?: Date;
}

export const FxRateCacheSchema = SchemaFactory.createForClass(FxRateCache);
