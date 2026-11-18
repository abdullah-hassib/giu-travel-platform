import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

@Schema({ collection: 'notifications', timestamps: { createdAt: true, updatedAt: false } })
export class Notification {
  declare _id: Types.ObjectId;

  @Prop({ type: String, required: true, index: true })
  recipientId!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 80 })
  eventType!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 500 })
  message!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 80 })
  resourceType!: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 128 })
  resourceId!: string;

  @Prop({ type: String, required: true })
  eventId!: string;

  @Prop({ type: Date, default: null })
  readAt!: Date | null;

  createdAt!: Date;
}

export type NotificationDocument = HydratedDocument<Notification>;
export const NotificationSchema = SchemaFactory.createForClass(Notification);
NotificationSchema.index({ recipientId: 1, createdAt: -1, _id: -1 });
NotificationSchema.index({ eventId: 1, recipientId: 1 }, { unique: true });
