import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model } from 'mongoose';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { todayUtc } from '../hotels/stay-rules';
import { User } from '../users/schemas/user.schema';
import { UserSession } from './schemas/user-session.schema';

@Injectable()
export class AccountLifecycleService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(UserSession.name)
    private readonly sessions: Model<UserSession>,
    @InjectModel(HotelBooking.name)
    private readonly hotels: Model<HotelBooking>,
    @InjectConnection() private readonly connection: Connection,
  ) {}

  async deactivate(userId: string): Promise<void> {
    await this.connection.transaction(async (session) => {
      // This write serializes with the account fence in payment settlement.
      // Failure of either the guard or session cleanup rolls it back.
      const account = await this.users
        .findOneAndUpdate(
          { _id: userId, status: 'active' },
          { $set: { status: 'deactivated' }, $inc: { sessionVersion: 1 } },
          { session, new: true },
        )
        .select('_id')
        .exec();
      if (!account) throw new NotFoundException('User not found');
      if (
        await this.hotels
          .exists({
            userId: account._id,
            status: 'Confirmed',
            checkOut: { $gte: todayUtc() },
          })
          .session(session)
          .exec()
      ) {
        throw new ConflictException(
          'Cancel upcoming Confirmed bookings before deactivating your account',
        );
      }
      await this.sessions
        .deleteMany({ userId: account._id }, { session })
        .exec();
    });
  }
}
