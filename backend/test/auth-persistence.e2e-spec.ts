import { ConfigService } from '@nestjs/config';
import { Model, Connection, createConnection } from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server-core';
import { AuthService } from '../src/modules/auth/auth.service';
import { UserSession, UserSessionSchema } from '../src/modules/auth/schemas/user-session.schema';
import { hashPassword } from '../src/modules/auth/security/password';
import { hashSessionToken, newSessionToken } from '../src/modules/auth/security/session-cookie';
import { User, UserDocument, UserSchema } from '../src/modules/users/schemas/user.schema';
import { UsersService } from '../src/modules/users/users.service';

// This suite owns a disposable local mongod. It never loads AppModule or .env.
describe('Authentication persistence (isolated MongoDB)', () => {
  jest.setTimeout(180_000);
  let server: MongoMemoryServer;
  let connection: Connection;
  let users: Model<User>;
  let sessions: Model<UserSession>;
  let usersService: UsersService;
  let auth: AuthService;
  let user: UserDocument;
  let passwordHash: string;

  beforeAll(async () => {
    server = await MongoMemoryServer.create();
    connection = await createConnection(server.getUri(), { dbName: 'giu_auth_tests' }).asPromise();
    users = connection.model(User.name, UserSchema);
    sessions = connection.model(UserSession.name, UserSessionSchema);
    await Promise.all([users.init(), sessions.init()]);
    usersService = new UsersService(users);
    auth = new AuthService(usersService, sessions, new ConfigService());
    passwordHash = await hashPassword('test-password1');
  });

  beforeEach(async () => {
    await Promise.all([users.deleteMany({}), sessions.deleteMany({})]);
    user = await users.create({ email: 'test@example.com', fullName: 'Test User', passwordHash });
  });

  afterEach(() => jest.restoreAllMocks());
  afterAll(async () => {
    await connection?.close();
    await server?.stop();
  });

  async function createSession(lastAuthenticatedAt: Date): Promise<string> {
    const token = newSessionToken();
    await sessions.create({
      userId: user._id,
      tokenHash: hashSessionToken(token),
      sessionVersion: 0,
      expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
      lastAuthenticatedAt,
    });
    return token;
  }

  it('creates an active session on login and renews activity on authenticated requests', async () => {
    const login = await auth.login({ email: user.email, password: 'test-password1' });
    const before = new Date(Date.now() - 29 * 60_000);
    await sessions.collection.updateOne({ tokenHash: hashSessionToken(login.token) }, { $set: { lastAuthenticatedAt: before } });
    await expect(auth.authenticate(login.token)).resolves.toMatchObject({ id: user._id.toString() });
    const session = await sessions.findOne({ tokenHash: hashSessionToken(login.token) }).orFail();
    expect(session.lastAuthenticatedAt!.getTime()).toBeGreaterThan(before.getTime());
  });

  it.each([30, 31])('rejects a session idle for %i minutes without refreshing it', async (minutes) => {
    const lastAuthenticatedAt = new Date(Date.now() - minutes * 60_000);
    const token = await createSession(lastAuthenticatedAt);
    await expect(auth.authenticate(token)).rejects.toMatchObject({ status: 401 });
    const session = await sessions.findOne({ tokenHash: hashSessionToken(token) }).orFail();
    expect(session.lastAuthenticatedAt).toEqual(lastAuthenticatedAt);
  });

  it('also enforces absolute expiry on a recently active session', async () => {
    const token = await createSession(new Date());
    await sessions.collection.updateOne({ tokenHash: hashSessionToken(token) }, { $set: { expiresAt: new Date(0) } });
    await expect(auth.authenticate(token)).rejects.toMatchObject({ status: 401 });
  });

  it.each([5, 31])('uses persisted timestamps for a legacy session last updated %i minutes ago', async (minutes) => {
    const token = newSessionToken();
    const timestamp = new Date(Date.now() - minutes * 60_000);
    await sessions.collection.insertOne({
      userId: user._id, tokenHash: hashSessionToken(token),
      expiresAt: new Date(Date.now() + 60 * 60_000), createdAt: timestamp, updatedAt: timestamp,
    });
    if (minutes < 30) {
      await expect(auth.authenticate(token)).resolves.toMatchObject({ id: user._id.toString() });
    } else {
      await expect(auth.authenticate(token)).rejects.toMatchObject({ status: 401 });
    }
  });

  it('does not refresh a suspended account session', async () => {
    const lastAuthenticatedAt = new Date(Date.now() - 10 * 60_000);
    const token = await createSession(lastAuthenticatedAt);
    await users.updateOne({ _id: user._id }, { $set: { status: 'suspended' } });
    await expect(auth.authenticate(token)).rejects.toMatchObject({ status: 401 });
    expect((await sessions.findOne({ tokenHash: hashSessionToken(token) }).orFail()).lastAuthenticatedAt).toEqual(lastAuthenticatedAt);
  });

  it('rejects a session revoked between account lookup and the activity update', async () => {
    const token = await createSession(new Date());
    const findById = usersService.findById.bind(usersService);
    jest.spyOn(usersService, 'findById').mockImplementationOnce(async (id) => {
      await auth.logout(token);
      return findById(id);
    });
    await expect(auth.authenticate(token)).rejects.toMatchObject({ status: 401 });
    expect(await sessions.countDocuments()).toBe(0);
  });

  it('rejects stale sessions after password changes', async () => {
    const token = await createSession(new Date());
    await auth.changePassword(user._id.toString(), 'test-password1', 'replacement-password1');
    await expect(auth.authenticate(token)).rejects.toMatchObject({ status: 401 });
  });

  it('atomically locks after five concurrent failures and cannot clear the lock with a correct password', async () => {
    const attempts = await Promise.allSettled(Array.from({ length: 5 }, () =>
      auth.login({ email: user.email, password: 'incorrect' }),
    ));
    expect(attempts.every((attempt) => attempt.status === 'rejected')).toBe(true);
    const locked = await users.findById(user._id).orFail();
    expect(locked.failedLoginAttempts).toBe(5);
    expect(locked.lockedUntil!.getTime()).toBeGreaterThan(Date.now() + 14 * 60_000);
    await expect(auth.login({ email: user.email, password: 'test-password1' })).rejects.toMatchObject({ status: 429 });
    expect(await sessions.countDocuments()).toBe(0);
  });

  it('starts a new failure window after lock expiry and resets it on successful login', async () => {
    await users.updateOne({ _id: user._id }, { $set: { failedLoginAttempts: 5, lockedUntil: new Date(0) } });
    await expect(auth.login({ email: user.email, password: 'incorrect' })).rejects.toMatchObject({ status: 401 });
    expect((await users.findById(user._id).orFail()).failedLoginAttempts).toBe(1);
    await auth.login({ email: user.email, password: 'test-password1' });
    const reset = await users.findById(user._id).orFail();
    expect(reset.failedLoginAttempts).toBe(0);
    expect(reset.lockedUntil).toBeNull();
  });
});
