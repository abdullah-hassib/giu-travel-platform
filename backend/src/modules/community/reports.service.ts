import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model, Types } from 'mongoose';
import { PAGE_SIZE, toPage } from '../../common/dto/page-number.dto';
import {
  OutboxEvent,
  outboxEvent,
} from '../../common/events/outbox-event.schema';
import {
  ModeratedContent,
  ModerationAction,
  preview,
  ReportTargetType,
} from '../../common/moderation';
import {
  DELETED_USER,
  displayNames,
  isDuplicateKey,
} from '../../common/mongo-helpers';
import { CommentsService } from '../blog/comments.service';
import { PostsService } from '../blog/posts.service';
import { Itinerary } from '../itineraries/schemas/itinerary.schema';
import { ReviewsService } from '../reviews/reviews.service';
import { User } from '../users/schemas/user.schema';
import { PublicUser } from '../users/users.service';
import { CreateReportDto, ReportsQueryDto } from './dto/report.dto';
import { ContentReport } from './schemas/content-report.schema';

type StoredReport = ContentReport & { _id: Types.ObjectId };

/**
 * GEN-09 reports and GEN-10 admin moderation. Every moderation action, the reports
 * it closes and its audit event (for Omar's GEN-07 consumer) commit together.
 */
@Injectable()
export class ReportsService {
  private readonly content: Record<ReportTargetType, ModeratedContent>;

  constructor(
    @InjectModel(ContentReport.name)
    private readonly reports: Model<ContentReport>,
    @InjectModel(OutboxEvent.name) private readonly outbox: Model<OutboxEvent>,
    @InjectModel(Itinerary.name) private readonly itineraries: Model<Itinerary>,
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectConnection() private readonly connection: Connection,
    posts: PostsService,
    comments: CommentsService,
    reviews: ReviewsService,
  ) {
    this.content = {
      post: posts,
      comment: comments,
      review: reviews,
      itinerary: this.itineraryContent(),
    };
  }

  /** GEN-09: report visible content with a reason, at most once per item. */
  async create(user: PublicUser, dto: CreateReportDto) {
    const target = await this.content[dto.targetType].findReportable(
      dto.targetId,
    );
    try {
      const report = await this.reports.create({
        reporterId: user.id,
        targetType: dto.targetType,
        targetId: dto.targetId,
        targetAuthorId: target.authorId,
        targetPreview: target.preview,
        reason: dto.reason,
      });
      return reportView(report.toObject(), user.fullName);
    } catch (error) {
      if (isDuplicateKey(error))
        throw new ConflictException('You already reported this item');
      throw error;
    }
  }

  /** GEN-10: reports for admins, oldest first so the queue is worked in order. */
  async list(query: ReportsQueryDto) {
    const filter = { status: query.status };
    const [rows, total] = await Promise.all([
      this.reports
        .find(filter)
        .sort({ createdAt: 1, _id: 1 })
        .skip((query.page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .lean(),
      this.reports.countDocuments(filter),
    ]);
    const names = await displayNames(
      this.users,
      rows.map((row) => row.reporterId),
    );
    return toPage(
      rows.map((row) =>
        reportView(row, names.get(row.reporterId.toString()) ?? DELETED_USER),
      ),
      query.page,
      total,
    );
  }

  /** GEN-10: dismiss the report, or hide/delete the reported content. */
  async resolve(
    admin: PublicUser,
    reportId: string,
    action: 'dismiss' | ModerationAction,
  ) {
    const resolved = await this.connection.transaction(async (session) => {
      const report = await this.reports
        .findById(reportId)
        .session(session)
        .lean();
      if (!report) throw new NotFoundException('Report not found');
      if (report.status !== 'open')
        throw new ConflictException('This report is already resolved');
      if (action === 'dismiss') {
        await this.reports.updateOne(
          { _id: report._id },
          {
            $set: {
              status: 'dismissed',
              resolvedBy: admin.id,
              resolvedAt: new Date(),
            },
          },
          { session },
        );
        await this.outbox.create(
          [
            outboxEvent('moderation.report_dismissed', admin.id, {
              reportId: report._id.toString(),
              targetType: report.targetType,
              targetId: report.targetId.toString(),
            }),
          ],
          { session },
        );
      } else {
        await this.applyModeration(
          admin,
          report.targetType,
          report.targetId.toString(),
          action,
          session,
        );
      }
      return (await this.reports.findById(report._id).session(session).lean())!;
    });
    const names = await displayNames(this.users, [resolved.reporterId]);
    return reportView(
      resolved,
      names.get(resolved.reporterId.toString()) ?? DELETED_USER,
    );
  }

  /** GEN-10: hide or delete any post, comment, review or itinerary directly. */
  async moderate(
    admin: PublicUser,
    type: ReportTargetType,
    id: string,
    action: ModerationAction,
  ) {
    await this.connection.transaction((session) =>
      this.applyModeration(admin, type, id, action, session),
    );
  }

  private async applyModeration(
    admin: PublicUser,
    type: ReportTargetType,
    id: string,
    action: ModerationAction,
    session: ClientSession,
  ): Promise<void> {
    const { authorId } = await this.content[type].moderate(id, action, session);
    await this.reports.updateMany(
      { targetType: type, targetId: id, status: 'open' },
      {
        $set: {
          status: action === 'hide' ? 'hidden' : 'deleted',
          resolvedBy: admin.id,
          resolvedAt: new Date(),
        },
      },
      { session },
    );
    await this.outbox.create(
      [
        outboxEvent(
          action === 'hide'
            ? 'moderation.content_hidden'
            : 'moderation.content_deleted',
          admin.id,
          {
            targetType: type,
            targetId: id,
            authorId,
          },
        ),
      ],
      { session },
    );
  }

  /**
   * Itineraries belong to the itinerary module. Hiding uses its existing visibility:
   * a private itinerary is visible only to its owner, as ITN-20 defines.
   */
  private itineraryContent(): ModeratedContent {
    return {
      findReportable: async (id) => {
        const itinerary = await this.itineraries
          .findOne({ _id: id, visibility: 'public' })
          .lean();
        if (!itinerary) throw new NotFoundException('Itinerary not found');
        return {
          authorId: itinerary.ownerId.toString(),
          preview: preview(itinerary.title),
        };
      },
      moderate: async (id, action, session) => {
        // __v is bumped so an owner's concurrent edit gets the itinerary module's 409.
        const itinerary =
          action === 'hide'
            ? await this.itineraries
                .findOneAndUpdate(
                  { _id: id },
                  { $set: { visibility: 'private' }, $inc: { __v: 1 } },
                  { session },
                )
                .lean()
            : await this.itineraries
                .findOneAndDelete({ _id: id }, { session })
                .lean();
        if (!itinerary) throw new NotFoundException('Itinerary not found');
        return { authorId: itinerary.ownerId.toString() };
      },
    };
  }
}

function reportView(report: StoredReport, reporterName: string) {
  return {
    id: report._id.toString(),
    targetType: report.targetType,
    targetId: report.targetId.toString(),
    targetAuthorId: report.targetAuthorId.toString(),
    targetPreview: report.targetPreview,
    reason: report.reason,
    reporterName,
    status: report.status,
    createdAt: report.createdAt,
    resolvedAt: report.resolvedAt ?? null,
  };
}
