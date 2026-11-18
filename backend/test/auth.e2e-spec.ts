import { ExecutionContext, INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { SessionGuard } from '../src/modules/auth/security/session.guard';
import { UsersController } from '../src/modules/auth/users.controller';
import { UsersService } from '../src/modules/users/users.service';
import { AccountLifecycleService } from '../src/modules/auth/account-lifecycle.service';

const user = { id: '507f1f77bcf86cd799439011', email: 'test@example.com', fullName: 'Tester', roles: ['traveler'], status: 'active' };

describe('Auth HTTP (isolated, no MongoDB)', () => {
  let app: INestApplication;
  const auth = {
    register: jest.fn(),
    login: jest.fn(),
    logout: jest.fn(),
    changePassword: jest.fn(),
    sessionTtlMilliseconds: 86_400_000,
  };
  const users = { updateProfile: jest.fn().mockResolvedValue(user) };
  const config = { get: jest.fn().mockReturnValue('test') };
  beforeAll(async () => {
    auth.register.mockResolvedValue(user);
    auth.login.mockResolvedValue({ user, token: 'a'.repeat(43), refreshToken: 'b'.repeat(43) + '.' + 'c'.repeat(43), accessExpiresAt: new Date(Date.now() + 300_000), expiresAt: new Date(Date.now() + 86_400_000) });
    auth.logout.mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      controllers: [AuthController, UsersController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ConfigService, useValue: config },
        { provide: UsersService, useValue: users },
        { provide: AccountLifecycleService, useValue: { deactivate: jest.fn() } },
        { provide: SessionGuard, useValue: { canActivate: () => true } },
      ],
    }).overrideGuard(SessionGuard).useValue({
      canActivate: (context: ExecutionContext) => {
        context.switchToHttp().getRequest<{ authUser: typeof user }>().authUser = user;
        return true;
      },
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
    await app.init();
  });
  afterAll(async () => app.close());

  it('rejects invalid registration bodies before calling the service', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send({ email: 'not-an-email', password: 'short', fullName: 'A' }).expect(400);
    expect(auth.register).not.toHaveBeenCalled();
  });
  it('registers a valid traveler', async () => {
    await request(app.getHttpServer()).post('/api/auth/register').send({ email: 'test@example.com', password: 'long-enough-password1', termsAccepted: true, fullName: 'Tester' }).expect(201);
    expect(auth.register).toHaveBeenCalledTimes(1);
  });
  it('sets an HttpOnly, SameSite=Strict cookie on successful login', async () => {
    const res = await request(app.getHttpServer()).post('/api/auth/login').send({ email: 'test@example.com', password: 'long-enough-password' }).expect(200);
    const cookie = res.headers['set-cookie'];
    const value = Array.isArray(cookie) ? cookie[0] : cookie;
    expect(value).toContain('HttpOnly');
    expect(value).toContain('SameSite=Strict');
    expect(value).toContain('giu_session=');
  });

  it.each(['   ', ' A ', 'A'.repeat(101), 42])('rejects invalid registration name %p before calling the service', async (fullName) => {
    auth.register.mockClear();
    await request(app.getHttpServer()).post('/api/auth/register')
      .send({ email: user.email, password: 'long-enough-password1', termsAccepted: true, fullName }).expect(400);
    expect(auth.register).not.toHaveBeenCalled();
  });

  it.each(['   ', ' A ', 'A'.repeat(101), 42])('rejects invalid profile name %p before calling the service', async (fullName) => {
    users.updateProfile.mockClear();
    await request(app.getHttpServer()).patch('/api/users/me').send({ fullName }).expect(400);
    expect(users.updateProfile).not.toHaveBeenCalled();
  });

  it('passes trimmed registration and profile names to their services', async () => {
    await request(app.getHttpServer()).post('/api/auth/register')
      .send({ email: user.email, password: 'long-enough-password1', termsAccepted: true, fullName: '  A Tester  ' }).expect(201);
    expect(auth.register).toHaveBeenLastCalledWith(expect.objectContaining({ fullName: 'A Tester' }));
    await request(app.getHttpServer()).patch('/api/users/me').send({ fullName: '  A Tester  ' }).expect(200);
    expect(users.updateProfile).toHaveBeenLastCalledWith(user.id, expect.objectContaining({ fullName: 'A Tester' }));
  });

  it.each([undefined, false, 'true', 1])('rejects registration without explicit boolean consent %p', async (termsAccepted) => {
    auth.register.mockClear();
    await request(app.getHttpServer()).post('/api/auth/register')
      .send({ email: user.email, fullName: user.fullName, password: 'valid-password1', termsAccepted }).expect(400);
    expect(auth.register).not.toHaveBeenCalled();
  });

  it.each(['abcdefgh', '12345678', 'abc1234'])('rejects a noncompliant registration password %p', async (password) => {
    auth.register.mockClear();
    await request(app.getHttpServer()).post('/api/auth/register')
      .send({ email: user.email, fullName: user.fullName, password, termsAccepted: true }).expect(400);
    expect(auth.register).not.toHaveBeenCalled();
  });

  it.each(['abcdefgh', '12345678', 'abc1234'])('rejects a noncompliant replacement password %p', async (newPassword) => {
    auth.changePassword.mockClear();
    await request(app.getHttpServer()).patch('/api/auth/change-password')
      .send({ currentPassword: 'old-password', newPassword }).expect(400);
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it('accepts a replacement password with both a letter and a digit', async () => {
    await request(app.getHttpServer()).patch('/api/auth/change-password')
      .send({ currentPassword: 'old-password', newPassword: 'new-password1' }).expect(204);
    expect(auth.changePassword).toHaveBeenLastCalledWith(user.id, 'old-password', 'new-password1');
  });

  it('issues both cookies as Secure, HttpOnly and SameSite=Strict in production', async () => {
    config.get.mockReturnValue('production');
    try {
      const response = await request(app.getHttpServer()).post('/api/auth/login')
        .send({ email: user.email, password: 'long-enough-password' }).expect(200);
      const cookies = response.headers['set-cookie'] as unknown as string[];
      expect(cookies).toHaveLength(2);
      expect(cookies.every((cookie) => cookie.includes('Secure') && cookie.includes('HttpOnly') && cookie.includes('SameSite=Strict'))).toBe(true);
      expect(Object.keys(response.body)).toEqual(['user']);
      expect(response.headers['cache-control']).toBe('no-store');
    } finally {
      config.get.mockReturnValue('test');
    }
  });
});
