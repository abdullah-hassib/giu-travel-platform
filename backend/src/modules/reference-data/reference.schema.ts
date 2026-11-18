import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Connection } from 'mongoose';
import {
  CountryRow,
  CityRow,
  AirportRow,
  AttractionRow,
} from './reference-dataset';

@Schema({ collection: 'reference_countries', versionKey: false })
export class ReferenceCountry implements CountryRow {
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ type: String, required: true, unique: true }) code!: string;
  @Prop({ type: String, required: true }) name!: string;
  @Prop({ type: String, required: true }) currency!: string;
}
@Schema({ collection: 'reference_cities', versionKey: false })
export class ReferenceCity implements CityRow {
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ type: String, required: true, unique: true }) city_id!: string;
  @Prop({ type: String, required: true }) name!: string;
  @Prop({ type: String, required: true, index: true }) country_code!: string;
}
@Schema({ collection: 'reference_airports', versionKey: false })
export class ReferenceAirport implements AirportRow {
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ type: String, required: true, unique: true }) iata_code!: string;
  @Prop({ type: String, required: true }) name!: string;
  @Prop({ type: String, required: true, index: true }) city_id!: string;
  @Prop({ type: String, required: true, index: true }) country_code!: string;
  @Prop({ type: String, required: true }) time_zone!: string;
}
@Schema({ collection: 'reference_attractions', versionKey: false })
export class ReferenceAttraction implements AttractionRow {
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ type: String, required: true, unique: true }) attraction_id!: string;
  @Prop({ type: String, required: true }) name!: string;
  @Prop({ type: String, required: true, index: true }) city_id!: string;
}
@Schema({ collection: 'reference_currencies', versionKey: false })
export class ReferenceCurrency {
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ type: String, required: true, unique: true }) code!: string;
}
@Schema({ collection: 'reference_seed_state', versionKey: false })
export class ReferenceSeedState {
  @Prop({ type: String, required: true }) _id!: string;
  @Prop({ type: String, required: true }) checksum!: string;
  @Prop({ type: Date, required: true }) seededAt!: Date;
  @Prop({ type: Object, required: true }) counts!: Record<string, number>;
}
export const REFERENCE_MODELS = [
  {
    name: ReferenceCountry.name,
    schema: SchemaFactory.createForClass(ReferenceCountry),
  },
  {
    name: ReferenceCity.name,
    schema: SchemaFactory.createForClass(ReferenceCity),
  },
  {
    name: ReferenceAirport.name,
    schema: SchemaFactory.createForClass(ReferenceAirport),
  },
  {
    name: ReferenceAttraction.name,
    schema: SchemaFactory.createForClass(ReferenceAttraction),
  },
  {
    name: ReferenceCurrency.name,
    schema: SchemaFactory.createForClass(ReferenceCurrency),
  },
  {
    name: ReferenceSeedState.name,
    schema: SchemaFactory.createForClass(ReferenceSeedState),
  },
];
export function referenceModels(connection: Connection) {
  for (const model of REFERENCE_MODELS)
    if (!connection.models[model.name])
      connection.model(model.name, model.schema);
  return {
    countries: connection.model<ReferenceCountry>(ReferenceCountry.name),
    cities: connection.model<ReferenceCity>(ReferenceCity.name),
    airports: connection.model<ReferenceAirport>(ReferenceAirport.name),
    attractions: connection.model<ReferenceAttraction>(
      ReferenceAttraction.name,
    ),
    currencies: connection.model<ReferenceCurrency>(ReferenceCurrency.name),
    state: connection.model<ReferenceSeedState>(ReferenceSeedState.name),
  };
}
