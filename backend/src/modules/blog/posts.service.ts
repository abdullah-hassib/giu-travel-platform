import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import {
  ClientSession,
  Connection,
  FilterQuery,
  Model,
  PipelineStage,
  Types,
} from 'mongoose';
import { PAGE_SIZE, toPage } from '../../common/dto/page-number.dto';
import {
  ModeratedContent,
  ModerationAction,
  preview,
} from '../../common/moderation';
import { escapeRegex, isDuplicateKey } from '../../common/mongo-helpers';
import { Itinerary } from '../itineraries/schemas/itinerary.schema';
import {
  MAX_IMAGES_PER_ITEM,
  MediaService,
  UploadedImage,
} from '../media-uploads/media.service';
import { User } from '../users/schemas/user.schema';
import { PublicUser } from '../users/users.service';
import { AuthorQueryDto, CreatePostDto, UpdatePostDto } from './dto/blog.dto';
import { BlogComment, BlogPost, PostLike } from './schemas/blog.schemas';

type StoredPost = BlogPost & { _id: Types.ObjectId };
type PublicPost = StoredPost & {
  author: { _id: Types.ObjectId; fullName: string };
};
type PostQuery = { page: number; tag?: string; search?: string };

@Injectable()
export class PostsService implements ModeratedContent {
  constructor(
    @InjectModel(BlogPost.name) private readonly posts: Model<BlogPost>,
    @InjectModel(BlogComment.name)
    private readonly comments: Model<BlogComment>,
    @InjectModel(PostLike.name) private readonly likes: Model<PostLike>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    @InjectConnection() private readonly connection: Connection,
    private readonly media: MediaService,
  ) {}

  /** BLG-01 */
  async create(user: PublicUser, dto: CreatePostDto) {
    const status = dto.status ?? 'draft';
    const post = await this.posts.create({
      authorId: user.id,
      title: dto.title,
      body: dto.body,
      tags: dto.tags ?? [],
      status,
      publishedAt: status === 'published' ? new Date() : null,
    });
    return ownPostView(post.toObject());
  }

  /** BLG-04/BLG-08: only the author edits; publishing a draft stamps its publish date. */
  async update(user: PublicUser, postId: string, dto: UpdatePostDto) {
    const post = await this.findOwn(user, postId);
    const changes: Partial<BlogPost> = { ...dto };
    if (dto.status === 'published' && !post.publishedAt)
      changes.publishedAt = new Date();
    const updated = await this.posts
      .findOneAndUpdate(
        { _id: post._id, authorId: post.authorId },
        { $set: changes },
        { new: true, runValidators: true },
      )
      .lean();
    if (!updated) throw new NotFoundException('Post not found');
    return ownPostView(updated);
  }

  /** BLG-04: deleting a post also removes its comments, likes and images. */
  async remove(user: PublicUser, postId: string): Promise<void> {
    const post = await this.findOwn(user, postId);
    const imageIds = await this.connection.transaction((session) =>
      this.deleteWithContent(post, session),
    );
    await this.removeImagesAfterCommit(imageIds);
  }

  /** BLG-02/BLG-09: published posts, optionally by tag or keyword. */
  list(query: PostQuery, extra: FilterQuery<BlogPost> = {}) {
    const stages = this.visiblePosts({
      ...(query.tag ? { tags: query.tag } : {}),
      ...extra,
    });
    let sort: Record<string, 1 | -1> = { publishedAt: -1, _id: -1 };
    if (query.search) {
      const keyword = new RegExp(escapeRegex(query.search), 'i');
      stages.push(
        {
          $match: {
            $or: [
              { title: keyword },
              { tags: keyword },
              { 'author.fullName': keyword },
            ],
          },
        },
        { $addFields: { score: { $add: ['$likeCount', '$commentCount'] } } },
      );
      // BLG-09: interaction score first, newest first on ties.
      sort = { score: -1, publishedAt: -1, _id: -1 };
    }
    return this.page(stages, sort, query.page);
  }

  /** BLG-02: one published post. */
  async get(postId: string) {
    const [post] = await this.posts.aggregate<PublicPost>(
      this.visiblePosts({ _id: new Types.ObjectId(postId) }),
    );
    if (!post) throw new NotFoundException('Post not found');
    return { ...postSummary(post), body: post.body, images: imagesOf(post) };
  }

  /** BLG-03: my posts, including drafts and hidden ones, with their full content for editing. */
  async mine(user: PublicUser, page: number) {
    const filter = { authorId: new Types.ObjectId(user.id) };
    const [rows, total] = await Promise.all([
      this.posts
        .find(filter)
        .sort({ updatedAt: -1, _id: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean(),
      this.posts.countDocuments(filter),
    ]);
    return toPage(rows.map(ownPostView), page, total);
  }

  /** BLG-12: public author page with published posts and public itineraries. */
  async author(authorId: string, query: AuthorQueryDto) {
    const author = await this.users
      .findOne({ _id: authorId, status: { $ne: 'deactivated' } })
      .select('fullName createdAt')
      .lean<{ _id: Types.ObjectId; fullName: string; createdAt?: Date }>();
    if (!author) throw new NotFoundException('Author not found');

    const itineraryFilter = { ownerId: author._id, visibility: 'public', moderationHidden: { $ne: true } };
    const [posts, itineraries, itineraryTotal] = await Promise.all([
      this.list({ page: query.postsPage }, { authorId: author._id }),
      this.itineraries
        .find(itineraryFilter)
        .select('title countryCodes startDate updatedAt days._id')
        .sort({ updatedAt: -1, _id: -1 })
        .skip((query.itinerariesPage - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean(),
      this.itineraries.countDocuments(itineraryFilter),
    ]);
    return {
      id: author._id.toString(),
      name: author.fullName,
      joinedAt: author.createdAt ?? null,
      posts,
      itineraries: toPage(
        itineraries.map((itinerary) => ({
          id: itinerary._id.toString(),
          title: itinerary.title,
          countryCodes: itinerary.countryCodes,
          startDate: itinerary.startDate,
          days: itinerary.days.length,
        })),
        query.itinerariesPage,
        itineraryTotal,
      ),
    };
  }

  /** BLG-06: the unique like index makes a second like fail instead of double counting. */
  async like(user: PublicUser, postId: string) {
    await this.assertPublished(postId);
    try {
      return await this.connection.transaction(async (session) => {
        await this.likes.create([{ postId, userId: user.id }], { session });
        const post = await this.posts
          .findByIdAndUpdate(
            postId,
            { $inc: { likeCount: 1 } },
            { new: true, session },
          )
          .lean();
        return { liked: true, likeCount: post!.likeCount };
      });
    } catch (error) {
      if (isDuplicateKey(error))
        throw new ConflictException('You already liked this post');
      throw error;
    }
  }

  async unlike(user: PublicUser, postId: string) {
    return this.connection.transaction(async (session) => {
      const removed = await this.likes.findOneAndDelete(
        { postId, userId: user.id },
        { session },
      );
      if (!removed) throw new NotFoundException('You have not liked this post');
      const post = await this.posts
        .findByIdAndUpdate(
          postId,
          { $inc: { likeCount: -1 } },
          { new: true, session },
        )
        .lean();
      return { liked: false, likeCount: post?.likeCount ?? 0 };
    });
  }

  /** BLG-10 under GEN-08: at most five images per post. */
  async addImage(
    user: PublicUser,
    postId: string,
    file: UploadedImage | undefined,
  ) {
    const post = await this.findOwn(user, postId);
    const image = await this.media.saveImage(file);
    const updated = await this.posts
      .findOneAndUpdate(
        {
          _id: post._id,
          [`images.${MAX_IMAGES_PER_ITEM - 1}`]: { $exists: false },
        },
        { $push: { images: image } },
        { new: true },
      )
      .lean();
    if (!updated) {
      await this.media.removeImage(image.id);
      throw new BadRequestException(
        `A post can have at most ${MAX_IMAGES_PER_ITEM} images`,
      );
    }
    return ownPostView(updated);
  }

  async removeImage(user: PublicUser, postId: string, imageId: string) {
    const post = await this.findOwn(user, postId);
    const updated = await this.posts
      .findOneAndUpdate(
        { _id: post._id, 'images.id': imageId },
        { $pull: { images: { id: imageId } } },
        { new: true },
      )
      .lean();
    if (!updated) throw new NotFoundException('Image not found');
    await this.media.removeImage(imageId);
    return ownPostView(updated);
  }

  async assertPublished(postId: string): Promise<void> {
    if (
      !(await this.posts.exists({
        _id: postId,
        status: 'published',
        hidden: false,
      }))
    ) {
      throw new NotFoundException('Post not found');
    }
  }

  async findReportable(id: string) {
    const post = await this.posts
      .findOne({ _id: id, status: 'published', hidden: false })
      .lean();
    if (!post) throw new NotFoundException('Post not found');
    return { authorId: post.authorId.toString(), preview: preview(post.title) };
  }

  async moderate(id: string, action: ModerationAction, session: ClientSession) {
    const post =
      action === 'hide'
        ? await this.posts
            .findOneAndUpdate(
              { _id: id },
              { $set: { hidden: true } },
              { session },
            )
            .lean()
        : await this.posts.findById(id).session(session).lean();
    if (!post) throw new NotFoundException('Post not found');
    if (action === 'delete') {
      const imageIdsToDelete = await this.deleteWithContent(post, session);
      return { authorId: post.authorId.toString(), imageIdsToDelete };
    }
    return { authorId: post.authorId.toString() };
  }

  private async findOwn(user: PublicUser, postId: string): Promise<StoredPost> {
    const post = await this.posts.findById(postId).lean();
    if (!post) throw new NotFoundException('Post not found');
    if (!post.authorId.equals(user.id))
      throw new ForbiddenException('Only the author can change this post');
    return post;
  }

  private async deleteWithContent(
    post: StoredPost,
    session: ClientSession,
  ): Promise<string[]> {
    await this.posts.deleteOne({ _id: post._id }, { session });
    await this.comments.deleteMany({ postId: post._id }, { session });
    await this.likes.deleteMany({ postId: post._id }, { session });
    // Never delete filesystem objects inside a DB transaction that can roll back.
    return post.images.map((image) => image.id);
  }

  /** Called only after the owning transaction commits; cleanup is best effort. */
  async removeImagesAfterCommit(ids: string[]): Promise<void> {
    await Promise.all(ids.map((id) => this.media.removeImage(id)));
  }

  /** Published, not hidden, and (ACC-12) not written by a deactivated account. */
  private visiblePosts(match: FilterQuery<BlogPost>): PipelineStage[] {
    return [
      { $match: { status: 'published', hidden: false, ...match } },
      {
        $lookup: {
          from: this.users.collection.name,
          localField: 'authorId',
          foreignField: '_id',
          as: 'author',
          pipeline: [{ $project: { fullName: 1, status: 1 } }],
        },
      },
      { $unwind: '$author' },
      { $match: { 'author.status': { $ne: 'deactivated' } } },
    ];
  }

  private async page(
    stages: PipelineStage[],
    sort: Record<string, 1 | -1>,
    page: number,
  ) {
    const [result] = await this.posts.aggregate<{
      data: PublicPost[];
      total: { count: number }[];
    }>([
      ...stages,
      {
        $facet: {
          data: [
            { $sort: sort },
            { $skip: (page - 1) * PAGE_SIZE },
            { $limit: PAGE_SIZE },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ]);
    return toPage(
      result.data.map(postSummary),
      page,
      result.total[0]?.count ?? 0,
    );
  }
}

function imagesOf(post: StoredPost) {
  return post.images.map(({ id, url }) => ({ id, url }));
}

/** List row: title, author, date, excerpt, tags and counters. */
function postSummary(post: PublicPost) {
  return {
    id: post._id.toString(),
    title: post.title,
    excerpt: preview(post.body),
    author: { id: post.author._id.toString(), name: post.author.fullName },
    publishedAt: post.publishedAt,
    tags: post.tags,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
  };
}

function ownPostView(post: StoredPost) {
  return {
    id: post._id.toString(),
    title: post.title,
    body: post.body,
    tags: post.tags,
    images: imagesOf(post),
    status: post.status,
    hidden: post.hidden,
    publishedAt: post.publishedAt,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
}
