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
import { PublicUser } from '../users/users.service';
import { CreateReviewDto, UpdateReviewDto } from './dto/review.dto';
import { ReviewsService } from './reviews.service';

@ApiTags('Hotel reviews')
@ApiBadRequestResponse({ description: 'Invalid input' })
@Controller()
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post('hotel-bookings/:id/review')
  @Authenticated('traveler')
  @ApiOperation({
    summary: 'HTL-23: rate (1-5) and optionally review my Completed stay, once',
  })
  @ApiNotFoundResponse({ description: 'Booking not found or not yours' })
  @ApiConflictResponse({
    description: 'Stay not Completed yet, or already reviewed',
  })
  create(
    @CurrentUser() user: PublicUser,
    @Param() params: IdParamDto,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviews.create(user, params.id, dto);
  }

  @Patch('reviews/:id')
  @Authenticated('traveler')
  @ApiOperation({
    summary: 'HTL-23: edit my review; the hotel average is recalculated',
  })
  @ApiNotFoundResponse({ description: 'Review not found or not yours' })
  update(
    @CurrentUser() user: PublicUser,
    @Param() params: IdParamDto,
    @Body() dto: UpdateReviewDto,
  ) {
    return this.reviews.update(user, params.id, dto);
  }

  @Delete('reviews/:id')
  @Authenticated('traveler')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: 'HTL-23: delete my review; the hotel average is recalculated',
  })
  @ApiNoContentResponse({ description: 'Deleted' })
  @ApiNotFoundResponse({ description: 'Review not found or not yours' })
  remove(@CurrentUser() user: PublicUser, @Param() params: IdParamDto) {
    return this.reviews.remove(user, params.id);
  }

  @Get('hotels/:id/reviews')
  @ApiOperation({
    summary:
      "HTL-24: a hotel's average rating, rating count and reviews (newest first)",
  })
  @ApiNotFoundResponse({ description: 'Hotel not found' })
  list(@Param() params: IdParamDto, @Query() query: PageNumberDto) {
    return this.reviews.listForHotel(params.id, query);
  }
}
