import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';

/** An uploaded image embedded in its owning post or hotel. */
@Schema({ _id: false })
export class StoredImage {
  @Prop({ type: String, required: true })
  id!: string;

  @Prop({ type: String, required: true })
  url!: string;
}

export const StoredImageSchema = SchemaFactory.createForClass(StoredImage);
