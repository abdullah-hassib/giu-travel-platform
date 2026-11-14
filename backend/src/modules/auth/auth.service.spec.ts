import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { Types } from 'mongoose';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { hashPassword } from './security/password';

const newDoc = (hash: string) => ({
  _id: new Types.ObjectId(),
  email: 'test@example.com',
  fullName: 'A Tester',
  passwordHash: hash,
  roles: ['traveler'] as const,
  status: 'active',
  failedLoginAttempts: 0,
  lockedUntil: null,
});

describe('AuthService', () => {
  it('rejects invalid credentials and records failure', async () => {
    const doc = newDoc(await hashPassword('correct-password'));
    const users = {
      findByEmailWithPassword: jest.fn().mockResolvedValue(doc),
      recordFailedLogin: jest.fn().mockResolvedValue(undefined),
    };
    const sessions = { create: jest.fn() };
    const auth = new AuthService(users as unknown as UsersService, sessions as never, new ConfigService());
    await expect(auth.login({ email: doc.email, password: 'wrong-password' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.recordFailedLogin).toHaveBeenCalledTimes(1);
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('creates a hashed server-side session after valid login', async () => {
    const doc = newDoc(await hashPassword('correct-password'));
    const users = {
      findByEmailWithPassword: jest.fn().mockResolvedValue(doc),
      resetFailedLogins: jest.fn().mockResolvedValue(undefined),
    };
    const sessions = { create: jest.fn().mockResolvedValue({}) };
    const auth = new AuthService(users as unknown as UsersService, sessions as never, new ConfigService());
    const result = await auth.login({ email: doc.email, password: 'correct-password' });
    expect(result.token).toHaveLength(43);
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(sessions.create).toHaveBeenCalledWith(expect.objectContaining({ tokenHash: expect.not.stringContaining(result.token) }));
  });
});
