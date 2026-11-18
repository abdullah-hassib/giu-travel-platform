import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, FilterQuery, Model } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { hashPassword } from '../auth/security/password';
import { UserSession } from '../auth/schemas/user-session.schema';
import { AdminOutboxEvent } from './schemas/admin-outbox.schema';
import { User } from '../users/schemas/user.schema';
import { AccountsPageDto, AccountsQueryDto, AdminAccountDto } from './dto/accounts-query.dto';

const ACCOUNT_PAGE_SIZE = 10;

@Injectable()
export class AdministrationService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(UserSession.name) private readonly sessions: Model<UserSession>,
    @InjectModel(AdminOutboxEvent.name) private readonly outbox: Model<AdminOutboxEvent>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async changeAccountStatus(actorId: string, targetId: string, status: 'active' | 'suspended'): Promise<void> {
    const id = randomUUID();
    await this.connection.transaction(async (session) => {
      const target = await this.users.findById(targetId).session(session).exec();
      if (!target) throw new NotFoundException('Account not found');
      if (target.roles.includes('admin')) throw new ForbiddenException('Only travelers and moderators can be suspended or reactivated');
      if (target.status === 'deactivated') throw new ConflictException('Self-deactivated accounts require a separate recovery policy');
      if (target.status === status) return;

      const result = await this.users.updateOne({ _id: target._id, status: target.status }, {
        $set: { status }, $inc: { sessionVersion: 1 },
      }, { session }).exec();
      if (result.matchedCount !== 1) throw new ConflictException('Account state changed; retry the operation');
      await this.sessions.deleteMany({ userId: target._id }).session(session).exec();
      await this.outbox.create([{
        id, type: status === 'suspended' ? 'account.suspended' : 'account.reactivated', version: 1,
        occurredAt: new Date().toISOString(), correlationId: id, actorId,
        payload: { targetUserId: target._id.toString(), previousStatus: target.status, newStatus: status },
        status: 'pending',
      }], { session });
    });
  }

  async resetPassword(actorId: string, targetId: string, temporaryPassword: string): Promise<void> {
    const passwordHash = await hashPassword(temporaryPassword);
    const id = randomUUID();
    await this.connection.transaction(async (session) => {
      const target = await this.users.findById(targetId).session(session).exec();
      if (!target) throw new NotFoundException('Account not found');
      if (target.roles.includes('admin')) throw new ForbiddenException('Only traveler and moderator passwords can be reset');
      await this.users.updateOne({ _id: target._id }, {
        $set: { passwordHash, mustChangePassword: true, failedLoginAttempts: 0, lockedUntil: null },
        $inc: { sessionVersion: 1 },
      }, { session }).exec();
      await this.sessions.deleteMany({ userId: target._id }).session(session).exec();
      await this.outbox.create([{
        id, type: 'account.password_reset', version: 1, occurredAt: new Date().toISOString(),
        correlationId: id, actorId, payload: { targetUserId: target._id.toString() }, status: 'pending',
      }], { session });
    });
  }

  async listAccounts(query: AccountsQueryDto): Promise<AccountsPageDto> {
    const filter: FilterQuery<User> = {};
    if (query.role) filter.roles = query.role;
    if (query.status) filter.status = query.status;
    if (query.search) {
      const literal = query.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      filter.$or = [
        { fullName: { $regex: literal, $options: 'i' } },
        { email: { $regex: literal, $options: 'i' } },
      ];
    }
    // Both branches see the same input stream, and the positive projection keeps
    // password hashes and security state out of aggregation responses.
    const [result] = await this.users.aggregate<{ data: AdminAccountDto[]; total: { count: number }[] }>([
      { $match: filter },
      { $facet: {
        data: [
          { $sort: { createdAt: -1, _id: -1 } },
          { $skip: (query.page - 1) * ACCOUNT_PAGE_SIZE },
          { $limit: ACCOUNT_PAGE_SIZE },
          { $project: {
            _id: 0, id: { $toString: '$_id' }, fullName: 1, email: 1, roles: 1, status: 1,
            createdAt: { $ifNull: ['$createdAt', null] },
          } },
        ],
        total: [{ $count: 'count' }],
      } },
    ]).exec();
    const total = result.total[0]?.count ?? 0;
    return {
      data: result.data,
      meta: { page: query.page, limit: ACCOUNT_PAGE_SIZE, total, totalPages: Math.ceil(total / ACCOUNT_PAGE_SIZE) },
    };
  }
}
