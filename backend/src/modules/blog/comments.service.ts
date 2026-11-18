import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { PAGE_SIZE, toPage } from '../../common/dto/page-number.dto';
import {
  ModeratedContent,
  ModerationAction,
  preview,
} from '../../common/moderation';
import { DELETED_USER, displayNames } from '../../common/mongo-helpers';
import { User } from '../users/schemas/user.schema';
import { PublicUser } from '../users/users.service';
import { CommentDto } from './dto/blog.dto';
import { PostsService } from './posts.service';
import { BlogComment, BlogPost } from './schemas/blog.schemas';

type StoredComment = BlogComment & { _id: Types.ObjectId };

/** BLG-05/BLG-07. The post's commentCount counts its visible comments. */
@Injectable()
export class CommentsService implements ModeratedContent {
  constructor(
    @InjectModel(BlogComment.name)
    private readonly comments: Model<BlogComment>,
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectConnection() private readonly connection: Connection,
    private readonly postsService: PostsService,
  ) {}

  async create(user: PublicUser, postId: string, dto: CommentDto) {
    await this.postsService.assertPublished(postId);
    const comment = await this.connection.transaction(async (session) => {
      const [created] = await this.comments.create(
        [{ postId, authorId: user.id, body: dto.body }],
        { session },
      );
      await this.posts.updateOne(
        { _id: postId },
        { $inc: { commentCount: 1 } },
        { session },
      );
      return created.toObject();
    });
    return commentView(comment, user.fullName);
  }

  /** Comments of a published post in chronological order. */
  async list(postId: string, page: number) {
    await this.postsService.assertPublished(postId);
    const filter = { postId: new Types.ObjectId(postId), hidden: false };
    const [rows, total] = await Promise.all([
      this.comments
        .find(filter)
        .sort({ createdAt: 1, _id: 1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean(),
      this.comments.countDocuments(filter),
    ]);
    const names = await displayNames(
      this.users,
      rows.map((row) => row.authorId),
    );
    return toPage(
      rows.map((row) =>
        commentView(row, names.get(row.authorId.toString()) ?? DELETED_USER),
      ),
      page,
      total,
    );
  }

  async update(user: PublicUser, commentId: string, dto: CommentDto) {
    await this.findOwn(user, commentId);
    const updated = await this.comments
      .findByIdAndUpdate(
        commentId,
        { $set: { body: dto.body } },
        { new: true, runValidators: true },
      )
      .lean();
    if (!updated) throw new NotFoundException('Comment not found');
    return commentView(updated, user.fullName);
  }

  async remove(user: PublicUser, commentId: string): Promise<void> {
    await this.findOwn(user, commentId);
    await this.connection.transaction((session) =>
      this.delete(commentId, session),
    );
  }

  async findReportable(id: string) {
    const comment = await this.comments
      .findOne({ _id: id, hidden: false })
      .lean();
    if (!comment) throw new NotFoundException('Comment not found');
    return {
      authorId: comment.authorId.toString(),
      preview: preview(comment.body),
    };
  }

  async moderate(id: string, action: ModerationAction, session: ClientSession) {
    if (action === 'delete') return this.delete(id, session);
    const comment = await this.comments
      .findOneAndUpdate({ _id: id }, { $set: { hidden: true } }, { session })
      .lean();
    if (!comment) throw new NotFoundException('Comment not found');
    if (!comment.hidden) await this.removeFromPostCount(comment, session);
    return { authorId: comment.authorId.toString() };
  }

  private async findOwn(
    user: PublicUser,
    commentId: string,
  ): Promise<StoredComment> {
    const comment = await this.comments.findById(commentId).lean();
    if (!comment) throw new NotFoundException('Comment not found');
    if (!comment.authorId.equals(user.id))
      throw new ForbiddenException('Only the author can change this comment');
    return comment;
  }

  private async delete(commentId: string, session: ClientSession) {
    const comment = await this.comments
      .findOneAndDelete({ _id: commentId }, { session })
      .lean();
    if (!comment) throw new NotFoundException('Comment not found');
    if (!comment.hidden) await this.removeFromPostCount(comment, session);
    return { authorId: comment.authorId.toString() };
  }

  private async removeFromPostCount(
    comment: StoredComment,
    session: ClientSession,
  ) {
    await this.posts.updateOne(
      { _id: comment.postId },
      { $inc: { commentCount: -1 } },
      { session },
    );
  }
}

function commentView(comment: StoredComment, authorName: string) {
  return {
    id: comment._id.toString(),
    postId: comment.postId.toString(),
    body: comment.body,
    authorName,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}
