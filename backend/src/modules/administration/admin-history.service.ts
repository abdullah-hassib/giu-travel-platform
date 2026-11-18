import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { OutboxEvent } from '../../common/events/outbox-event.schema';
import { AdminOutboxEvent } from './schemas/admin-outbox.schema';
import {
  ACCOUNT_HISTORY_ACTIONS,
  DOMAIN_HISTORY_ACTIONS,
  AdminHistoryPageDto,
  AdminHistoryQueryDto,
  AdminHistoryViewDto,
} from './dto/admin-history.dto';

/** Read actual committed action envelopes; delivery/consumer state is reported separately. */
@Injectable()
export class AdminHistoryService {
  constructor(
    @InjectModel(AdminOutboxEvent.name)
    private readonly accounts: Model<AdminOutboxEvent>,
    @InjectModel(OutboxEvent.name) private readonly domain: Model<OutboxEvent>,
  ) {}
  async list(query: AdminHistoryQueryDto): Promise<AdminHistoryPageDto> {
    if (query.from && query.to && query.from > query.to)
      throw new BadRequestException('from cannot be after to');
    const match: Record<string, unknown> = {};
    if (query.action) match.action = query.action;
    if (query.actorId) match.actorId = query.actorId;
    if (query.from || query.to)
      match.occurredAt = {
        ...(query.from && { $gte: `${query.from}T00:00:00.000Z` }),
        ...(query.to && { $lte: `${query.to}T23:59:59.999Z` }),
      };
    const common = {
      _id: 0,
      id: 1,
      action: '$type',
      actorId: 1,
      occurredAt: 1,
      correlationId: 1,
      outcome: { $literal: 'committed' },
      deliveryStatus: { $ifNull: ['$status', 'pending'] },
    };
    const [result] = await this.accounts
      .aggregate<{ data: AdminHistoryViewDto[]; count: { total: number }[] }>([
        {
          $match: {
            type: { $in: [...ACCOUNT_HISTORY_ACTIONS] },
            actorId: { $type: 'string', $ne: '' },
          },
        },
        {
          $project: {
            ...common,
            target: {
              type: { $literal: 'account' },
              id: '$payload.targetUserId',
            },
          },
        },
        {
          $unionWith: {
            coll: this.domain.collection.name,
            pipeline: [
              {
                $match: {
                  type: { $in: [...DOMAIN_HISTORY_ACTIONS] },
                  actorId: { $type: 'string', $ne: '' },
                },
              },
              {
                $project: {
                  ...common,
                  target: {
                    type: {
                      $switch: {
                        branches: [
                          {
                            case: {
                              $in: [
                                '$type',
                                ['hotel.deactivated', 'hotel.reactivated'],
                              ],
                            },
                            then: 'hotel',
                          },
                          {
                            case: {
                              $eq: ['$type', 'moderation.report_dismissed'],
                            },
                            then: 'report',
                          },
                        ],
                        default: '$payload.targetType',
                      },
                    },
                    id: {
                      $switch: {
                        branches: [
                          {
                            case: {
                              $in: [
                                '$type',
                                ['hotel.deactivated', 'hotel.reactivated'],
                              ],
                            },
                            then: '$payload.hotelId',
                          },
                          {
                            case: {
                              $eq: ['$type', 'moderation.report_dismissed'],
                            },
                            then: '$payload.reportId',
                          },
                        ],
                        default: '$payload.targetId',
                      },
                    },
                  },
                },
              },
            ],
          },
        },
        { $match: match },
        {
          $facet: {
            data: [
              { $sort: { occurredAt: -1, id: -1 } },
              { $skip: (query.page - 1) * 10 },
              { $limit: 10 },
            ],
            count: [{ $count: 'total' }],
          },
        },
      ])
      .exec();
    const total = result.count[0]?.total ?? 0;
    return {
      data: result.data,
      meta: {
        page: query.page,
        limit: 10,
        total,
        totalPages: Math.ceil(total / 10),
      },
    };
  }
}
