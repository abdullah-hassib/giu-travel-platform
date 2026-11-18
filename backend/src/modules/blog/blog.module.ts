import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import {
  Itinerary,
  ItinerarySchema,
} from '../itineraries/schemas/itinerary.schema';
import { MediaUploadsModule } from '../media-uploads/media-uploads.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import {
  BlogPagesController,
  CommentsController,
  PostsController,
} from './blog.controller';
import { CommentsService } from './comments.service';
import { PostsService } from './posts.service';
import {
  BlogComment,
  BlogCommentSchema,
  BlogPost,
  BlogPostSchema,
  PostLike,
  PostLikeSchema,
} from './schemas/blog.schemas';

/** Posts, tags, comments, likes and author pages (BLG-01..BLG-12). */
@Module({
  imports: [
    AuthModule,
    MediaUploadsModule,
    MongooseModule.forFeature([
      { name: BlogPost.name, schema: BlogPostSchema },
      { name: BlogComment.name, schema: BlogCommentSchema },
      { name: PostLike.name, schema: PostLikeSchema },
      { name: User.name, schema: UserSchema },
      // Read-only: public itineraries on author pages (BLG-12).
      { name: Itinerary.name, schema: ItinerarySchema },
    ]),
  ],
  controllers: [PostsController, CommentsController, BlogPagesController],
  providers: [PostsService, CommentsService],
  exports: [PostsService, CommentsService],
})
export class BlogModule {}
