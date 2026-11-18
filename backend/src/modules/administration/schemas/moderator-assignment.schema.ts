import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import {
  PROVIDER_KINDS,
  ProviderKind,
} from '../provider-administration.adapter';

@Schema({ collection: 'moderator_assignments', timestamps: true })
export class ModeratorAssignment {
  declare _id: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, unique: true })
  userId!: Types.ObjectId;
  @Prop({ type: String, enum: PROVIDER_KINDS, required: true })
  providerType!: ProviderKind;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  providerId!: Types.ObjectId;
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  assignedBy!: Types.ObjectId;
}
export const ModeratorAssignmentSchema =
  SchemaFactory.createForClass(ModeratorAssignment);
ModeratorAssignmentSchema.index({ providerType: 1, providerId: 1 });
