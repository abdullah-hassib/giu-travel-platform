import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ _id: false })
export class StoredRange {
  @Prop({ type: String, required: true })
  from!: string;

  @Prop({ type: String, required: true })
  to!: string;
}

const StoredRangeSchema = SchemaFactory.createForClass(StoredRange);

/** HTL-03: one individually bookable room. Prices are USD cents (PAY-04). */
@Schema({ collection: 'hotel_rooms', timestamps: true })
export class HotelRoom {
  declare _id: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Hotel', required: true })
  hotelId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  name!: string;

  @Prop({ type: String, required: true, trim: true })
  type!: string;

  @Prop({ type: Number, required: true, min: 1 })
  beds!: number;

  @Prop({ type: Number, required: true, min: 1 })
  maxOccupancy!: number;

  @Prop({ type: Number, required: true, min: 1 })
  pricePerNightMinor!: number;

  // HTL-04: non-overlapping ranges when the room can be booked.
  @Prop({ type: [StoredRangeSchema], default: [] })
  availability!: StoredRange[];

  // HTL-06: ranges the moderator closed.
  @Prop({ type: [StoredRangeSchema], default: [] })
  blocked!: StoredRange[];

  @Prop({ type: Boolean, default: true })
  active!: boolean;

  /**
   * Bumped by every transaction that changes what a room is booked or open for.
   * Two such transactions on the same room therefore write-conflict, and MongoDB
   * retries the loser, which then sees the winner's result.
   */
  @Prop({ type: Number, default: 0 })
  inventoryVersion!: number;
}

export const HotelRoomSchema = SchemaFactory.createForClass(HotelRoom);
HotelRoomSchema.index({ hotelId: 1, name: 1 }, { unique: true });
