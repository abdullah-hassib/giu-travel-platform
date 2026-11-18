import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import {
  REPORT_TARGET_TYPES,
  ReportTargetType,
} from '../../../common/moderation';

export const REPORT_STATUSES = [
  'open',
  'dismissed',
  'hidden',
  'deleted',
] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

/** GEN-09: a user's report of a post, comment, review or itinerary. */
@Schema({ collection: 'content_reports', timestamps: true })
export class ContentReport {
  declare _id: Types.ObjectId;
  declare createdAt: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  reporterId!: Types.ObjectId;

  @Prop({ type: String, enum: REPORT_TARGET_TYPES, required: true })
  targetType!: ReportTargetType;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  targetId!: Types.ObjectId;

  // Snapshot for the admin, kept even if the content is later deleted.
  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  targetAuthorId!: Types.ObjectId;

  @Prop({ type: String, required: true })
  targetPreview!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 500 })
  reason!: string;

  @Prop({ type: String, enum: REPORT_STATUSES, default: 'open' })
  status!: ReportStatus;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  resolvedBy?: Types.ObjectId;

  @Prop({ type: Date })
  resolvedAt?: Date;
}

export const ContentReportSchema = SchemaFactory.createForClass(ContentReport);
// At most one report per user per item.
ContentReportSchema.index(
  { reporterId: 1, targetType: 1, targetId: 1 },
  { unique: true },
);
ContentReportSchema.index({ status: 1, createdAt: 1 });
ContentReportSchema.index({ targetType: 1, targetId: 1, status: 1 });
