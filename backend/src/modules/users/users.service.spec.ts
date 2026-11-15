import { UnauthorizedException } from '@nestjs/common';
import { Model } from 'mongoose';
import { User } from './schemas/user.schema';
import { UsersService } from './users.service';

describe('UsersService password changes', () => {
  it('updates the password and session generation in one conditional write', async () => {
    const updateOne = jest.fn().mockReturnValue({ exec: async () => ({ matchedCount: 1 }) });
    const users = new UsersService({ updateOne } as unknown as Model<User>);
    await users.updatePassword('user-id', 'new-hash', 'verified-old-hash');
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'user-id', status: 'active', passwordHash: 'verified-old-hash' },
      { $set: { passwordHash: 'new-hash' }, $inc: { sessionVersion: 1 } },
    );
  });

  it('rejects a password change when another update has already replaced the verified password', async () => {
    const updateOne = jest.fn().mockReturnValue({ exec: async () => ({ matchedCount: 0 }) });
    const users = new UsersService({ updateOne } as unknown as Model<User>);
    await expect(users.updatePassword('user-id', 'new-hash', 'stale-hash')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
