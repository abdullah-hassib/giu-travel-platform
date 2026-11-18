import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Schema as MongooseSchema, Types } from 'mongoose';
import {
  StoredImage,
  StoredImageSchema,
} from '../../media-uploads/stored-image.schema';

export const POST_STATUSES = ['draft', 'published'] as const;
export type PostStatus = (typeof POST_STATUSES)[number];

/** BLG-01: a blog post, saved as a draft or published. */
@Schema({ collection: 'blog_posts', timestamps: true })
export class BlogPost {
  declare _id: Types.ObjectId;
  declare createdAt: Date;
  declare updatedAt: Date;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  authorId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 150 })
  title!: string;

  @Prop({ type: String, required: true, maxlength: 20000 })
  body!: string;

  // BLG-08: up to five lowercase tags.
  @Prop({ type: [String], default: [] })
  tags!: string[];

  @Prop({ type: [StoredImageSchema], default: [] })
  images!: StoredImage[];

  @Prop({ type: String, enum: POST_STATUSES, required: true })
  status!: PostStatus;

  // Set the first time the post is published.
  @Prop({ type: Date, default: null })
  publishedAt!: Date | null;

  // Counters change in the same transaction as the like/comment they count.
  @Prop({ type: Number, default: 0 })
  likeCount!: number;

  @Prop({ type: Number, default: 0 })
  commentCount!: number;

  // GEN-10: hidden posts are visible only to their author and admins.
  @Prop({ type: Boolean, default: false })
  hidden!: boolean;
}

export const BlogPostSchema = SchemaFactory.createForClass(BlogPost);
BlogPostSchema.index({ status: 1, hidden: 1, publishedAt: -1 });
BlogPostSchema.index({ tags: 1 });
BlogPostSchema.index({ authorId: 1, updatedAt: -1 });

/** BLG-05: a comment on a published post. */
@Schema({ collection: 'blog_comments', timestamps: true })
export class BlogComment {
  declare _id: Types.ObjectId;
  declare createdAt: Date;
  declare updatedAt: Date;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'BlogPost',
    required: true,
  })
  postId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  authorId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true, maxlength: 500 })
  body!: string;

  @Prop({ type: Boolean, default: false })
  hidden!: boolean;
}

export const BlogCommentSchema = SchemaFactory.createForClass(BlogComment);
BlogCommentSchema.index({ postId: 1, hidden: 1, createdAt: 1 });

/** BLG-06: the unique index allows one like per user per post. */
@Schema({ collection: 'blog_likes', timestamps: true })
export class PostLike {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'BlogPost',
    required: true,
  })
  postId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true })
  userId!: Types.ObjectId;
}

export const PostLikeSchema = SchemaFactory.createForClass(PostLike);
PostLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });
