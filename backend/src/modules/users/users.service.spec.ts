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
      { $set: { passwordHash: 'new-hash', mustChangePassword: false }, $inc: { sessionVersion: 1 } },
    );
  });

  it('rejects a password change when another update has already replaced the verified password', async () => {
    const updateOne = jest.fn().mockReturnValue({ exec: async () => ({ matchedCount: 0 }) });
    const users = new UsersService({ updateOne } as unknown as Model<User>);
    await expect(users.updatePassword('user-id', 'new-hash', 'stale-hash')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('UsersService login state updates', () => {
  it('preserves the consent timestamp when creating a traveler', async () => {
    const create = jest.fn().mockResolvedValue({});
    const users = new UsersService({ create } as unknown as Model<User>);
    const acceptedAt = new Date('2026-11-15T12:00:00Z');
    await users.createTraveler('TEST@example.com', '  Test User  ', 'password-hash', acceptedAt);
    expect(create).toHaveBeenCalledWith({
      email: 'test@example.com', fullName: 'Test User', passwordHash: 'password-hash',
      roles: ['traveler'], termsAcceptedAt: acceptedAt,
    });
  });
  it('increments the failed counter and sets lock expiry in one guarded write', async () => {
    const lockedUntil = new Date(Date.now() + 15 * 60_000);
    const findOneAndUpdate = jest.fn().mockReturnValue({ exec: async () => ({ lockedUntil }) });
    const updateOne = jest.fn();
    const users = new UsersService({ findOneAndUpdate, updateOne } as unknown as Model<User>);
    await expect(users.recordFailedLogin('user-id', 5, 15, 'current-hash')).resolves.toBe(true);
    expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
    const [filter, pipeline] = findOneAndUpdate.mock.calls[0];
    expect(filter).toEqual({
      _id: 'user-id', status: 'active', passwordHash: 'current-hash',
      lockedUntil: { $not: { $gt: expect.any(Date) } },
    });
    expect(pipeline[0].$set.failedLoginAttempts.$cond).toEqual([
      { $and: [{ $ne: [{ $ifNull: ['$lockedUntil', null] }, null] }, { $lte: ['$lockedUntil', expect.any(Date)] }] },
      1,
      { $add: [{ $ifNull: ['$failedLoginAttempts', 0] }, 1] },
    ]);
    expect(pipeline[1].$set.lockedUntil.$cond).toEqual([
      { $gte: ['$failedLoginAttempts', 5] }, expect.any(Date), null,
    ]);
    const lockStart: Date = filter.lockedUntil.$not.$gt;
    const lockEnd: Date = pipeline[1].$set.lockedUntil.$cond[1];
    expect(lockEnd.getTime() - lockStart.getTime()).toBe(15 * 60_000);
    expect(updateOne).not.toHaveBeenCalled();
  });

  it('only resets login failures when the account is active, unlocked and still has the verified password', async () => {
    const updateOne = jest.fn().mockReturnValue({ exec: async () => ({ matchedCount: 0 }) });
    const users = new UsersService({ updateOne } as unknown as Model<User>);
    await expect(users.resetFailedLogins('user-id', 'verified-hash')).resolves.toBe(false);
    expect(updateOne).toHaveBeenCalledWith(
      { _id: 'user-id', status: 'active', passwordHash: 'verified-hash', lockedUntil: { $not: { $gt: expect.any(Date) } } },
      { $set: { failedLoginAttempts: 0, lockedUntil: null } },
    );
  });
});
