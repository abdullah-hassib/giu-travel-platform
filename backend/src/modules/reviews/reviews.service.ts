import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import {
  PAGE_SIZE,
  PageNumberDto,
  toPage,
} from '../../common/dto/page-number.dto';
import {
  ModeratedContent,
  ModerationAction,
  preview,
} from '../../common/moderation';
import {
  DELETED_USER,
  displayNames,
  isDuplicateKey,
} from '../../common/mongo-helpers';
import {
  HotelBooking,
  refreshBookingStatuses,
} from '../hotel-bookings/schemas/hotel-booking.schema';
import { averageRating, Hotel } from '../hotels/schemas/hotel.schema';
import { User } from '../users/schemas/user.schema';
import { PublicUser } from '../users/users.service';
import { ModeratorAssignmentsService } from '../administration/moderator-assignments.module';
import {
  CreateReviewDto,
  CreateReviewReplyDto,
  UpdateReviewDto,
} from './dto/review.dto';
import { Review, ReviewReply } from './schemas/review.schema';

type StoredReview = Review & { _id: Types.ObjectId };

/**
 * HTL-23/HTL-24. The hotel's ratingSum/ratingCount change in the same transaction as
 * the review itself, so the average always matches the visible reviews.
 */
@Injectable()
export class ReviewsService implements ModeratedContent {
  constructor(
    @InjectModel(Review.name) private readonly reviews: Model<Review>,
    @InjectModel(HotelBooking.name)
    private readonly bookings: Model<HotelBooking>,
    @InjectModel(Hotel.name) private readonly hotels: Model<Hotel>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectConnection() private readonly connection: Connection,
    private readonly assignments: ModeratorAssignmentsService,
  ) {}

  /** One review per Completed reservation, no matter how many rooms it had. */
  async create(user: PublicUser, bookingId: string, dto: CreateReviewDto) {
    await refreshBookingStatuses(this.bookings);
    const booking = await this.bookings
      .findOne({ _id: bookingId, userId: user.id })
      .lean();
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.status !== 'Completed') {
      throw new ConflictException('Only completed stays can be reviewed');
    }
    try {
      const review = await this.connection.transaction(async (session) => {
        const [created] = await this.reviews.create(
          [
            {
              bookingId: booking._id,
              hotelId: booking.hotelId,
              userId: booking.userId,
              rating: dto.rating,
              comment: dto.comment ?? '',
            },
          ],
          { session },
        );
        await this.hotels.updateOne(
          { _id: booking.hotelId },
          { $inc: { ratingSum: dto.rating, ratingCount: 1 } },
          { session },
        );
        return created.toObject();
      });
      return reviewView(review, user.fullName);
    } catch (error) {
      if (isDuplicateKey(error))
        throw new ConflictException('You already reviewed this stay');
      throw error;
    }
  }

  async update(user: PublicUser, reviewId: string, dto: UpdateReviewDto) {
    return this.connection.transaction(async (session) => {
      const review = await this.reviews
        .findOne({ _id: reviewId, userId: user.id })
        .session(session)
        .lean();
      if (!review) throw new NotFoundException('Review not found');
      const updated = await this.reviews
        .findByIdAndUpdate(
          review._id,
          { $set: dto },
          { new: true, runValidators: true, session },
        )
        .lean();
      if (!review.hidden && dto.rating !== undefined) {
        await this.hotels.updateOne(
          { _id: review.hotelId },
          { $inc: { ratingSum: dto.rating - review.rating } },
          { session },
        );
      }
      return reviewView(updated!, user.fullName);
    });
  }

  async remove(user: PublicUser, reviewId: string): Promise<void> {
    await this.connection.transaction(async (session) => {
      const review = await this.reviews
        .findOneAndDelete({ _id: reviewId, userId: user.id }, { session })
        .lean();
      if (!review) throw new NotFoundException('Review not found');
      if (!review.hidden) await this.removeFromAverage(review, session);
    });
  }

  /** HTL-26: reply once to a visible review of the moderator's active hotel. */
  async reply(user: PublicUser, reviewId: string, dto: CreateReviewReplyDto) {
    const assignment = await this.assignments.getForModerator(user.id);
    if (
      !user.roles.includes('hotel_moderator') ||
      assignment?.providerType !== 'hotel'
    ) {
      throw new ForbiddenException('A hotel moderator assignment is required');
    }
    if (
      !(await this.hotels.exists({ _id: assignment.providerId, active: true }))
    ) {
      throw new NotFoundException('Hotel not found');
    }
    const filter = {
      _id: reviewId,
      hotelId: assignment.providerId,
      hidden: false,
    };
    const reply: ReviewReply = {
      moderatorId: new Types.ObjectId(user.id),
      comment: dto.comment,
      createdAt: new Date(),
    };
    // One conditional document write: concurrent requests cannot overwrite a reply.
    // MongoDB's null equality also matches legacy reviews with no reply field.
    const updated = await this.reviews
      .findOneAndUpdate(
        { ...filter, reply: null },
        { $set: { reply } },
        { new: true, runValidators: true },
      )
      .lean();
    if (!updated) {
      if (await this.reviews.exists(filter))
        throw new ConflictException('This review already has a hotel reply');
      throw new NotFoundException('Review not found');
    }
    return replyView(reply);
  }

  /** HTL-24: average, count and reviews of an active hotel, newest first. */
  async listForHotel(hotelId: string, query: PageNumberDto) {
    const hotel = await this.hotels
      .findOne({ _id: hotelId, active: true })
      .lean();
    if (!hotel) throw new NotFoundException('Hotel not found');
    const filter = { hotelId: hotel._id, hidden: false };
    const [rows, total] = await Promise.all([
      this.reviews
        .find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip((query.page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean(),
      this.reviews.countDocuments(filter),
    ]);
    const names = await displayNames(
      this.users,
      rows.map((row) => row.userId),
    );
    return {
      averageRating: averageRating(hotel),
      ratingCount: hotel.ratingCount,
      ...toPage(
        rows.map((row) =>
          reviewView(row, names.get(row.userId.toString()) ?? DELETED_USER),
        ),
        query.page,
        total,
      ),
    };
  }

  async findReportable(id: string) {
    const review = await this.reviews
      .findOne({ _id: id, hidden: false })
      .lean();
    if (!review) throw new NotFoundException('Review not found');
    return {
      authorId: review.userId.toString(),
      preview: preview(review.comment) || `Rated ${review.rating}/5`,
    };
  }

  async moderate(id: string, action: ModerationAction, session: ClientSession) {
    // Both calls return the review as it was before the change.
    const review =
      action === 'hide'
        ? await this.reviews
            .findOneAndUpdate(
              { _id: id },
              { $set: { hidden: true } },
              { session },
            )
            .lean()
        : await this.reviews.findOneAndDelete({ _id: id }, { session }).lean();
    if (!review) throw new NotFoundException('Review not found');
    if (!review.hidden) await this.removeFromAverage(review, session);
    return { authorId: review.userId.toString() };
  }

  private async removeFromAverage(
    review: StoredReview,
    session: ClientSession,
  ): Promise<void> {
    await this.hotels.updateOne(
      { _id: review.hotelId },
      { $inc: { ratingSum: -review.rating, ratingCount: -1 } },
      { session },
    );
  }
}

function reviewView(review: StoredReview, authorName: string) {
  return {
    id: review._id.toString(),
    bookingId: review.bookingId.toString(),
    hotelId: review.hotelId.toString(),
    rating: review.rating,
    comment: review.comment,
    authorName,
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
    reply: review.reply ? replyView(review.reply) : null,
  };
}

function replyView(reply: ReviewReply) {
  return { comment: reply.comment, createdAt: reply.createdAt };
}
