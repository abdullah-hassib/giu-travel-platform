import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ collection: 'user_sessions', timestamps: true })
export class UserSession {
  declare _id: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, ref: 'User', index: true })
  userId!: Types.ObjectId;

  // Store only a hash. A MongoDB leak must not reveal live session credentials.
  @Prop({ type: String, required: true, unique: true })
  tokenHash!: string;

  @Prop({ type: String })
  refreshFamilyHash?: string;

  @Prop({ type: String })
  refreshTokenHash?: string;

  @Prop({ type: Date })
  accessExpiresAt?: Date;

  @Prop({ type: Number, default: 0, min: 0 })
  sessionVersion!: number;

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date })
  lastAuthenticatedAt?: Date;
}

export const UserSessionSchema = SchemaFactory.createForClass(UserSession);
UserSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
UserSessionSchema.index({ refreshFamilyHash: 1 }, { unique: true, sparse: true });
