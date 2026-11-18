import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiConflictResponse,
  ApiNoContentResponse,
  ApiNotFoundResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  Authenticated,
  CurrentUser,
} from '../../common/auth/authenticated.decorator';
import { IdParamDto } from '../../common/dto/id-param.dto';
import { PageNumberDto } from '../../common/dto/page-number.dto';
import {
  ImageParamsDto,
  ImageUpload,
} from '../media-uploads/image-upload.decorator';
import { UploadedImage } from '../media-uploads/media.service';
import { PublicUser } from '../users/users.service';
import { CommentsService } from './comments.service';
import {
  AuthorQueryDto,
  CommentDto,
  CreatePostDto,
  PostListQueryDto,
  TagParamDto,
  UpdatePostDto,
} from './dto/blog.dto';
import { PostsService } from './posts.service';

@ApiTags('Blog posts')
@ApiBadRequestResponse({ description: 'Invalid input' })
@ApiNotFoundResponse({ description: 'Post not found or not published' })
@Controller('posts')
export class PostsController {
  constructor(
    private readonly posts: PostsService,
    private readonly comments: CommentsService,
  ) {}

  @Post()
  @Authenticated('traveler')
  @ApiOperation({
    summary:
      'BLG-01/BLG-08: create a post as draft or published (up to 5 tags)',
  })
  create(@CurrentUser() user: PublicUser, @Body() dto: CreatePostDto) {
    return this.posts.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'BLG-02/BLG-09: browse published posts by tag, or search title/tags/author name',
    description:
      'Browsing is newest first. A search is ordered by likes + comments, then newest. Ten per page.',
  })
  list(@Query() query: PostListQueryDto) {
    return this.posts.list(query);
  }

  @Get('mine')
  @Authenticated('traveler')
  @ApiOperation({
    summary: 'BLG-03: my posts, including drafts, with like and comment counts',
  })
  mine(@CurrentUser() user: PublicUser, @Query() query: PageNumberDto) {
    return this.posts.mine(user, query.page);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'BLG-02: read a published post (comments are at /posts/{id}/comments)',
  })
  get(@Param() params: IdParamDto) {
    return this.posts.get(params.id);
  }

  @Patch(':id')
  @Authenticated('traveler')
  @ApiOperation({
    summary: 'BLG-04/BLG-08: edit my post, its tags or its status',
  })
  update(
    @CurrentUser() user: PublicUser,
    @Param() params: IdParamDto,
    @Body() dto: UpdatePostDto,
  ) {
    return this.posts.update(user, params.id, dto);
  }

  @Delete(':id')
  @Authenticated('traveler')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'BLG-04: delete my post with its comments, likes and images',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  remove(@CurrentUser() user: PublicUser, @Param() params: IdParamDto) {
    return this.posts.remove(user, params.id);
  }

  @Get(':id/comments')
  @ApiOperation({
    summary: 'BLG-05: comments on a published post, oldest first',
  })
  listComments(@Param() params: IdParamDto, @Query() query: PageNumberDto) {
    return this.comments.list(params.id, query.page);
  }

  @Post(':id/comments')
  @Authenticated('traveler')
  @ApiOperation({
    summary: 'BLG-05: comment on a published post (1-500 characters)',
  })
  comment(
    @CurrentUser() user: PublicUser,
    @Param() params: IdParamDto,
    @Body() dto: CommentDto,
  ) {
    return this.comments.create(user, params.id, dto);
  }

  @Post(':id/like')
  @Authenticated('traveler')
  @ApiOperation({ summary: 'BLG-06: like a post (once per user)' })
  @ApiConflictResponse({ description: 'Already liked' })
  like(@CurrentUser() user: PublicUser, @Param() params: IdParamDto) {
    return this.posts.like(user, params.id);
  }

  @Delete(':id/like')
  @Authenticated('traveler')
  @ApiOperation({ summary: 'BLG-06: remove my like' })
  unlike(@CurrentUser() user: PublicUser, @Param() params: IdParamDto) {
    return this.posts.unlike(user, params.id);
  }

  @Post(':id/images')
  @Authenticated('traveler')
  @ImageUpload()
  @ApiOperation({
    summary:
      'BLG-10/GEN-08: attach an image to my post (JPG/PNG, max 5 MB, max 5 images)',
  })
  addImage(
    @CurrentUser() user: PublicUser,
    @Param() params: IdParamDto,
    @UploadedFile() file: UploadedImage | undefined,
  ) {
    return this.posts.addImage(user, params.id, file);
  }

  @Delete(':id/images/:imageId')
  @Authenticated('traveler')
  @ApiOperation({ summary: 'BLG-10: remove an image from my post' })
  removeImage(
    @CurrentUser() user: PublicUser,
    @Param() params: ImageParamsDto,
  ) {
    return this.posts.removeImage(user, params.id, params.imageId);
  }
}

@ApiTags('Blog comments')
@ApiBadRequestResponse({ description: 'Invalid input' })
@ApiNotFoundResponse({ description: 'Comment not found' })
@Controller('comments')
export class CommentsController {
  constructor(private readonly comments: CommentsService) {}

  @Patch(':id')
  @Authenticated('traveler')
  @ApiOperation({ summary: 'BLG-07: edit my comment' })
  update(
    @CurrentUser() user: PublicUser,
    @Param() params: IdParamDto,
    @Body() dto: CommentDto,
  ) {
    return this.comments.update(user, params.id, dto);
  }

  @Delete(':id')
  @Authenticated('traveler')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'BLG-07: delete my comment' })
  @ApiNoContentResponse({ description: 'Deleted' })
  remove(@CurrentUser() user: PublicUser, @Param() params: IdParamDto) {
    return this.comments.remove(user, params.id);
  }
}

@ApiTags('Blog posts')
@ApiNotFoundResponse({ description: 'Author not found' })
@Controller()
export class BlogPagesController {
  constructor(private readonly posts: PostsService) {}

  @Get('tags/:tag/posts')
  @ApiOperation({
    summary: 'BLG-08: published posts with this tag, newest first',
  })
  byTag(@Param() params: TagParamDto, @Query() query: PageNumberDto) {
    return this.posts.list({ page: query.page, tag: params.tag });
  }

  @Get('authors/:id')
  @ApiOperation({
    summary:
      'BLG-12: public author page with name, join date, published posts and public itineraries',
  })
  author(@Param() params: IdParamDto, @Query() query: AuthorQueryDto) {
    return this.posts.author(params.id, query);
  }
}
