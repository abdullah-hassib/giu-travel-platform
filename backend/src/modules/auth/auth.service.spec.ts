import { ConfigService } from '@nestjs/config';
import { HttpException, UnauthorizedException } from '@nestjs/common';
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
  it('returns a lockout response on the fifth failed attempt', async () => {
    const doc = newDoc(await hashPassword('correct-password'));
    const users = {
      findByEmailWithPassword: jest.fn().mockResolvedValue(doc),
      recordFailedLogin: jest.fn().mockResolvedValue(true),
    };
    const sessions = { create: jest.fn() };
    const auth = new AuthService(users as unknown as UsersService, sessions as never, new ConfigService());
    await expect(auth.login({ email: doc.email, password: 'wrong' })).rejects.toMatchObject({ status: 429 });
    expect(users.recordFailedLogin).toHaveBeenCalledWith(doc._id.toString(), 5, 15, doc.passwordHash);
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('rejects a login that loses a race to a lockout or account change', async () => {
    const doc = newDoc(await hashPassword('correct-password'));
    const users = {
      findByEmailWithPassword: jest.fn().mockResolvedValue(doc),
      resetFailedLogins: jest.fn().mockResolvedValue(false),
    };
    const sessions = { create: jest.fn() };
    const auth = new AuthService(users as unknown as UsersService, sessions as never, new ConfigService());
    await expect(auth.login({ email: doc.email, password: 'correct-password' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('does not reset or extend a currently locked account', async () => {
    const doc = { ...newDoc('unused'), lockedUntil: new Date(Date.now() + 60_000) };
    const users = {
      findByEmailWithPassword: jest.fn().mockResolvedValue(doc),
      recordFailedLogin: jest.fn(),
      resetFailedLogins: jest.fn(),
    };
    const auth = new AuthService(users as unknown as UsersService, {} as never, new ConfigService());
    await expect(auth.login({ email: doc.email, password: 'wrong' })).rejects.toBeInstanceOf(HttpException);
    expect(users.recordFailedLogin).not.toHaveBeenCalled();
    expect(users.resetFailedLogins).not.toHaveBeenCalled();
  });

  it('starts an expired lock window through the atomic failed-attempt update', async () => {
    const doc = { ...newDoc(await hashPassword('correct-password')), lockedUntil: new Date(0) };
    const users = {
      findByEmailWithPassword: jest.fn().mockResolvedValue(doc),
      recordFailedLogin: jest.fn().mockResolvedValue(false),
      resetFailedLogins: jest.fn(),
    };
    const auth = new AuthService(users as unknown as UsersService, {} as never, new ConfigService());
    await expect(auth.login({ email: doc.email, password: 'wrong' })).rejects.toBeInstanceOf(UnauthorizedException);
    expect(users.recordFailedLogin).toHaveBeenCalledTimes(1);
    expect(users.resetFailedLogins).not.toHaveBeenCalled();
  });

  it('reports a suspended account separately from invalid credentials', async () => {
    const users = { findByEmailWithPassword: jest.fn().mockResolvedValue({ ...newDoc('unused'), status: 'suspended' }) };
    const auth = new AuthService(users as unknown as UsersService, {} as never, new ConfigService());
    await expect(auth.login({ email: 'test@example.com', password: 'wrong' })).rejects.toThrow('Account suspended');
  });
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
      resetFailedLogins: jest.fn().mockResolvedValue(true),
    };
    const sessions = { create: jest.fn().mockResolvedValue({}) };
    const auth = new AuthService(users as unknown as UsersService, sessions as never, new ConfigService());
    const result = await auth.login({ email: doc.email, password: 'correct-password' });
    expect(result.token).toHaveLength(43);
    expect(result.user).not.toHaveProperty('passwordHash');
    expect(sessions.create).toHaveBeenCalledWith(expect.objectContaining({ tokenHash: expect.not.stringContaining(result.token) }));
  });

  it.each([
    [undefined, undefined, true],
    [undefined, 1, false],
    [0, 1, false],
    [2, 2, true],
  ])('checks session version %p against account version %p', async (sessionVersion, userVersion, accepted) => {
    const doc = { ...newDoc('unused'), sessionVersion: userVersion };
    const users = { findById: jest.fn().mockResolvedValue(doc) };
    const session = { userId: doc._id, sessionVersion };
    const sessions = {
      findOne: jest.fn().mockReturnValue({ exec: async () => session }),
      updateOne: jest.fn().mockReturnValue({ exec: async () => ({ matchedCount: 1 }) }),
    };
    const auth = new AuthService(users as unknown as UsersService, sessions as never, new ConfigService());
    if (accepted) {
      await expect(auth.authenticate('test-token')).resolves.toEqual(UsersService.view(doc as never));
    } else {
      await expect(auth.authenticate('test-token')).rejects.toBeInstanceOf(UnauthorizedException);
    }
  });

  it('rejects a stale login session inserted after password change', async () => {
    const doc = { ...newDoc(await hashPassword('correct-password')), sessionVersion: 0 };
    let currentVersion = 0;
    const users = {
      findByEmailWithPassword: jest.fn().mockResolvedValue(doc),
      resetFailedLogins: jest.fn().mockResolvedValue(true),
      findById: jest.fn().mockImplementation(async () => ({ ...doc, sessionVersion: currentVersion })),
    };
    let storedSession: { userId: Types.ObjectId; sessionVersion: number };
    const sessions = {
      create: jest.fn().mockImplementation(async (session: typeof storedSession) => {
        // Password update wins the race before the old-password login inserts its session.
        currentVersion = 1;
        storedSession = session;
      }),
      findOne: jest.fn().mockReturnValue({ exec: async () => storedSession }),
    };
    const auth = new AuthService(users as unknown as UsersService, sessions as never, new ConfigService());
    const login = await auth.login({ email: doc.email, password: 'correct-password' });
    await expect(auth.authenticate(login.token)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('keeps old sessions invalid when password change cleanup fails', async () => {
    const doc = { ...newDoc(await hashPassword('correct-password')), sessionVersion: 0 };
    const users = {
      findByIdWithPassword: jest.fn().mockResolvedValue({ ...doc }),
      updatePassword: jest.fn().mockImplementation(async () => { doc.sessionVersion += 1; }),
      findById: jest.fn().mockResolvedValue(doc),
    };
    const sessions = {
      deleteMany: jest.fn().mockReturnValue({ exec: async () => { throw new Error('cleanup failed'); } }),
      findOne: jest.fn().mockReturnValue({ exec: async () => ({ userId: doc._id, sessionVersion: 0 }) }),
    };
    const auth = new AuthService(users as unknown as UsersService, sessions as never, new ConfigService());
    await expect(auth.changePassword(doc._id.toString(), 'correct-password', 'new-password')).rejects.toThrow('cleanup failed');
    expect(users.updatePassword).toHaveBeenCalledWith(doc._id.toString(), expect.any(String), doc.passwordHash);
    await expect(auth.authenticate('old-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
