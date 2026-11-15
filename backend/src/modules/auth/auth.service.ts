import { HttpException, HttpStatus, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model } from 'mongoose';
import { UsersService, PublicUser } from '../users/users.service';
import { RegisterDto, LoginDto } from './dto/auth.dto';
import { UserSession } from './schemas/user-session.schema';
import { hashPassword, verifyPassword } from './security/password';
import { hashSessionToken, newSessionToken } from './security/session-cookie';

const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;
const ACCESS_TTL_MS = 5 * 60 * 1000;

export interface LoginResult {
  user: PublicUser;
  token: string;
  refreshToken: string;
  expiresAt: Date;
  accessExpiresAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    @InjectModel(UserSession.name) private readonly sessions: Model<UserSession>,
    private readonly config: ConfigService,
  ) {}

  get sessionTtlMilliseconds(): number {
    return Number(this.config.get<number>('SESSION_TTL_HOURS', 24)) * 60 * 60 * 1000;
  }

  async register(dto: RegisterDto): Promise<PublicUser> {
    const passwordHash = await hashPassword(dto.password);
    const created = await this.users.createTraveler(dto.email, dto.fullName, passwordHash, new Date());
    return UsersService.view(created);
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    const user = await this.users.findByEmailWithPassword(dto.email);
    if (!user || user.status === 'deactivated') throw new UnauthorizedException('Invalid email or password');
    if (user.status === 'suspended') throw new UnauthorizedException('Account suspended');
    if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
      throw new HttpException('Account temporarily locked', HttpStatus.TOO_MANY_REQUESTS);
    }
    if (!(await verifyPassword(dto.password, user.passwordHash))) {
      const locked = await this.users.recordFailedLogin(
        user._id.toString(),
        Number(this.config.get<number>('AUTH_MAX_FAILED_ATTEMPTS', 5)),
        Number(this.config.get<number>('AUTH_LOCKOUT_MINUTES', 15)),
        user.passwordHash,
      );
      if (locked) throw new HttpException('Account temporarily locked', HttpStatus.TOO_MANY_REQUESTS);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!(await this.users.resetFailedLogins(user._id.toString(), user.passwordHash))) {
      throw new UnauthorizedException('Account or login state has changed; sign in again');
    }
    const token = newSessionToken();
    const refreshToken = `${newSessionToken()}.${newSessionToken()}`;
    const expiresAt = new Date(Date.now() + this.sessionTtlMilliseconds);
    const accessExpiresAt = new Date(Math.min(Date.now() + ACCESS_TTL_MS, expiresAt.getTime()));
    await this.sessions.create({
      userId: user._id,
      tokenHash: hashSessionToken(token),
      refreshFamilyHash: hashSessionToken(refreshToken.split('.')[0]),
      refreshTokenHash: hashSessionToken(refreshToken),
      accessExpiresAt,
      sessionVersion: user.sessionVersion ?? 0,
      lastAuthenticatedAt: new Date(),
      expiresAt,
    });
    return { token, refreshToken, expiresAt, accessExpiresAt, user: UsersService.view(user) };
  }

  async authenticate(token: string): Promise<PublicUser> {
    const session = await this.sessions.findOne(this.accessSessionFilter(token, new Date())).exec();
    if (!session) throw new UnauthorizedException('Authentication required');
    const user = await this.users.findById(session.userId.toString());
    if (!user || user.status !== 'active') throw new UnauthorizedException('Authentication required');
    // Missing versions on pre-existing records represent the original session generation.
    if ((session.sessionVersion ?? 0) !== (user.sessionVersion ?? 0)) {
      throw new UnauthorizedException('Authentication required');
    }
    // Recheck expiry and revocation after loading the account. Failed authentication
    // cannot prolong a session, and concurrent requests cannot move activity backwards.
    const authenticatedAt = new Date();
    const result = await this.sessions.updateOne(
      this.accessSessionFilter(token, authenticatedAt),
      { $max: { lastAuthenticatedAt: authenticatedAt } },
    ).exec();
    if (result.matchedCount !== 1) throw new UnauthorizedException('Authentication required');
    return UsersService.view(user);
  }

  private accessSessionFilter(token: string, now: Date): FilterQuery<UserSession> {
    return {
      ...this.activeSessionFilter(now),
      tokenHash: hashSessionToken(token),
      $or: [{ accessExpiresAt: { $exists: false } }, { accessExpiresAt: { $gt: now } }],
    };
  }

  private activeSessionFilter(now: Date): FilterQuery<UserSession> {
    return {
      expiresAt: { $gt: now },
      $expr: { $gt: [
        { $ifNull: ['$lastAuthenticatedAt', { $ifNull: ['$updatedAt', '$createdAt'] }] },
        new Date(now.getTime() - SESSION_IDLE_TIMEOUT_MS),
      ] },
    };
  }

  async refresh(refreshToken: string | null): Promise<LoginResult> {
    if (!refreshToken || !/^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(refreshToken)) {
      throw new UnauthorizedException('Authentication required');
    }
    const family = refreshToken.split('.')[0];
    const refreshFamilyHash = hashSessionToken(family);
    const refreshTokenHash = hashSessionToken(refreshToken);
    const session = await this.sessions.findOne({ refreshFamilyHash, ...this.activeSessionFilter(new Date()) }).exec();
    if (!session) throw new UnauthorizedException('Authentication required');
    if (session.refreshTokenHash !== refreshTokenHash) {
      await this.sessions.deleteOne({ _id: session._id }).exec();
      throw new UnauthorizedException('Refresh token reuse detected; sign in again');
    }
    const user = await this.users.findById(session.userId.toString());
    if (!user || user.status !== 'active' || (user.sessionVersion ?? 0) !== (session.sessionVersion ?? 0)) {
      await this.sessions.deleteOne({ _id: session._id }).exec();
      throw new UnauthorizedException('Authentication required');
    }
    const token = newSessionToken();
    const nextRefreshToken = `${family}.${newSessionToken()}`;
    const now = new Date();
    const accessExpiresAt = new Date(Math.min(now.getTime() + ACCESS_TTL_MS, session.expiresAt.getTime()));
    const rotated = await this.sessions.findOneAndUpdate(
      { _id: session._id, refreshTokenHash, ...this.activeSessionFilter(now) },
      {
        $set: { tokenHash: hashSessionToken(token), refreshTokenHash: hashSessionToken(nextRefreshToken), accessExpiresAt },
        $max: { lastAuthenticatedAt: now },
      },
      { new: true },
    ).exec();
    if (!rotated) {
      // A concurrent use of the same credential invalidates the family. Clients
      // must serialize refresh requests, including across browser tabs.
      await this.sessions.deleteOne({ _id: session._id }).exec();
      throw new UnauthorizedException('Refresh state changed; sign in again');
    }
    return { token, refreshToken: nextRefreshToken, expiresAt: session.expiresAt, accessExpiresAt, user: UsersService.view(user) };
  }

  async logout(token: string | null, refreshToken: string | null = null): Promise<void> {
    const credentials: FilterQuery<UserSession>[] = [];
    if (token) credentials.push({ tokenHash: hashSessionToken(token) });
    if (refreshToken && /^[A-Za-z0-9_-]{43}\.[A-Za-z0-9_-]{43}$/.test(refreshToken)) {
      credentials.push({ refreshFamilyHash: hashSessionToken(refreshToken.split('.')[0]) });
    }
    if (credentials.length) await this.sessions.deleteMany({ $or: credentials }).exec();
  }

  async revokeAllSessions(userId: string): Promise<void> {
    await this.sessions.deleteMany({ userId }).exec();
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.users.findByIdWithPassword(userId);
    if (!user || user.status !== 'active' || !(await verifyPassword(currentPassword, user.passwordHash))) {
      throw new UnauthorizedException('Current password is incorrect');
    }
    const passwordHash = await hashPassword(newPassword);
    await this.users.updatePassword(userId, passwordHash, user.passwordHash);
    // Invalidate every existing session; client must sign in with the new password.
    await this.revokeAllSessions(userId);
  }
}
