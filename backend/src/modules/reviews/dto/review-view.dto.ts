import { ApiProperty } from '@nestjs/swagger';

export class ReviewReplyViewDto {
  @ApiProperty({ example: 'Thank you for your feedback.' })
  comment!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: Date;
}

export class ReviewViewDto {
  @ApiProperty() id!: string;
  @ApiProperty() bookingId!: string;
  @ApiProperty() hotelId!: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) rating!: number;
  @ApiProperty() comment!: string;
  @ApiProperty() authorName!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
  @ApiProperty({ type: String, format: 'date-time' }) updatedAt!: Date;

  @ApiProperty({
    type: ReviewReplyViewDto,
    nullable: true,
    description:
      'The hotel response, or null when no reply exists. Private moderator identity is not exposed.',
  })
  reply!: ReviewReplyViewDto | null;
}

class ReviewPageMetaDto {
  @ApiProperty({ minimum: 1 }) page!: number;
  @ApiProperty({ enum: [10] }) limit!: number;
  @ApiProperty({ minimum: 0 }) total!: number;
  @ApiProperty({ minimum: 0 }) totalPages!: number;
}

export class HotelReviewsPageDto {
  @ApiProperty({ type: Number, nullable: true, minimum: 1, maximum: 5 })
  averageRating!: number | null;
  @ApiProperty({ minimum: 0 }) ratingCount!: number;
  @ApiProperty({ type: [ReviewViewDto] }) data!: ReviewViewDto[];
  @ApiProperty({ type: ReviewPageMetaDto }) meta!: ReviewPageMetaDto;
}
