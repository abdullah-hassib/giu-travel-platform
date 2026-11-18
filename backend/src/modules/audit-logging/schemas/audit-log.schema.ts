import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export const AUDIT_OUTCOMES = ['success', 'failure'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

@Schema({ collection: 'audit_logs', timestamps: { createdAt: false, updatedAt: false }, versionKey: false })
export class AuditLog {
  declare _id: Types.ObjectId;

  @Prop({ type: String, required: true, unique: true, immutable: true })
  eventId!: string;

  @Prop({ type: String, default: null, immutable: true })
  actorId!: string | null;

  @Prop({ type: String, required: true, trim: true, maxlength: 100, immutable: true })
  action!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 80, immutable: true })
  resourceType!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 128, immutable: true })
  resourceId!: string;

  @Prop({ type: Date, required: true, immutable: true })
  occurredAt!: Date;

  @Prop({ type: String, default: null, immutable: true })
  correlationId!: string | null;

  @Prop({ type: String, required: true, enum: AUDIT_OUTCOMES, immutable: true })
  outcome!: AuditOutcome;

  @Prop({ type: Map, of: Object, default: undefined, immutable: true })
  metadata?: Map<string, string | number | boolean | null>;
}

export type AuditLogDocument = HydratedDocument<AuditLog>;
export const AuditLogSchema = SchemaFactory.createForClass(AuditLog);
AuditLogSchema.index({ occurredAt: -1, _id: -1 });
AuditLogSchema.index({ actorId: 1, occurredAt: -1 });
AuditLogSchema.index({ action: 1, occurredAt: -1 });
