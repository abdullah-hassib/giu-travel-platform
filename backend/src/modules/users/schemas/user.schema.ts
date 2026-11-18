import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { CURRENCIES } from '../../reference-data/official-reference';

export const USER_ROLES = ['traveler', 'admin', 'airline_moderator', 'hotel_moderator'] as const;
export type UserRole = (typeof USER_ROLES)[number];
export const USER_STATUSES = ['active', 'suspended', 'deactivated'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];

@Schema({ collection: 'users', timestamps: true })
export class User {
  declare _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ type: String, required: true, select: false })
  passwordHash!: string;

  @Prop({ type: Number, default: 0, min: 0 })
  sessionVersion!: number;

  @Prop({ type: Boolean, default: false })
  mustChangePassword!: boolean;

  @Prop({ type: String, required: true, trim: true })
  fullName!: string;

  @Prop({ type: String, default: null })
  phone?: string | null;

  @Prop({ type: String, enum: CURRENCIES, default: null })
  preferredCurrency?: string | null;

  @Prop({ type: Date })
  termsAcceptedAt?: Date;

  @Prop({ type: [String], enum: USER_ROLES, default: ['traveler'] })
  roles!: UserRole[];

  @Prop({ type: String, enum: USER_STATUSES, default: 'active' })
  status!: UserStatus;

  @Prop({ type: Number, default: 0, min: 0 })
  failedLoginAttempts!: number;

  @Prop({ type: Date, default: null })
  lockedUntil?: Date | null;
}

export type UserDocument = HydratedDocument<User>;
export const UserSchema = SchemaFactory.createForClass(User);
UserSchema.index({ status: 1 });
