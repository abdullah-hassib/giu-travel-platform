import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { User } from '../users/schemas/user.schema';
import { AccountsPageDto, AccountsQueryDto, AdminAccountDto } from './dto/accounts-query.dto';

const ACCOUNT_PAGE_SIZE = 10;

@Injectable()
export class AdministrationService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

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
