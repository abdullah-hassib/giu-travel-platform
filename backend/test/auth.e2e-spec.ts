import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { SessionGuard } from '../src/modules/auth/security/session.guard';

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
  beforeAll(async () => {
    auth.register.mockResolvedValue(user);
    auth.login.mockResolvedValue({ user, token: 'a'.repeat(43) });
    auth.logout.mockResolvedValue(undefined);
    const module = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: ConfigService, useValue: { get: () => 'test' } },
        { provide: SessionGuard, useValue: { canActivate: () => true } },
      ],
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
    await request(app.getHttpServer()).post('/api/auth/register').send({ email: 'test@example.com', password: 'long-enough-password', fullName: 'Tester' }).expect(201);
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
});
