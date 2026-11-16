import { ConflictException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { User, UserDocument } from './schemas/user.schema';
import { UpdateProfileDto } from './dto/update-profile.dto';

export interface PublicUser {
  id: string;
  email: string;
  fullName: string;
  phone?: string | null;
  preferredCurrency?: string | null;
  roles: User['roles'];
  status: User['status'];
  mustChangePassword?: boolean;
}

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly users: Model<User>) {}

  static view(user: UserDocument): PublicUser {
    return {
      id: user._id.toString(),
      email: user.email,
      fullName: user.fullName,
      phone: user.phone ?? null,
      preferredCurrency: user.preferredCurrency ?? null,
      roles: user.roles,
      status: user.status,
      mustChangePassword: user.mustChangePassword ?? false,
    };
  }

  async findByEmailWithPassword(email: string): Promise<UserDocument | null> {
    return this.users.findOne({ email: email.toLowerCase() }).select('+passwordHash').exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.users.findById(id).exec();
  }

  async findByIdWithPassword(id: string): Promise<UserDocument | null> {
    if (!Types.ObjectId.isValid(id)) return null;
    return this.users.findById(id).select('+passwordHash').exec();
  }

  async createTraveler(email: string, fullName: string, passwordHash: string, termsAcceptedAt?: Date): Promise<UserDocument> {
    try {
      return await this.users.create({ email: email.toLowerCase(), fullName: fullName.trim(), passwordHash, roles: ['traveler'], termsAcceptedAt });
    } catch (error: unknown) {
      // MongoDB's unique index must be the final arbiter of concurrent registrations.
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        throw new ConflictException('Email is already registered');
      }
      throw error;
    }
  }

  /** Explicit one-time bootstrap only. Never expose admin creation via public registration. */
  async seedAdministrator(email: string, passwordHash: string): Promise<'created' | 'already-exists'> {
    const existing = await this.users.findOne({ email: email.toLowerCase() }).exec();
    if (existing) {
      if (existing.roles.includes('admin')) return 'already-exists';
      throw new ConflictException('An account with this email already exists and is not an administrator');
    }
    try {
      await this.users.create({
        email: email.toLowerCase(),
        fullName: 'Platform Administrator',
        passwordHash,
        roles: ['admin'],
        status: 'active',
      });
      return 'created';
    } catch (error: unknown) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        throw new ConflictException('Administrator registration raced with another request');
      }
      throw error;
    }
  }

  async recordFailedLogin(userId: string, maxAttempts: number, lockoutMinutes: number, expectedPasswordHash: string): Promise<boolean> {
    const now = new Date();
    // The filter and pipeline execute as one atomic document update. Expired locks
    // start a fresh attempt window; requests arriving during a lock cannot extend it.
    const user = await this.users.findOneAndUpdate(
      { _id: userId, status: 'active', passwordHash: expectedPasswordHash, lockedUntil: { $not: { $gt: now } } },
      [
        { $set: { failedLoginAttempts: {
          $cond: [
            { $and: [{ $ne: [{ $ifNull: ['$lockedUntil', null] }, null] }, { $lte: ['$lockedUntil', now] }] },
            1,
            { $add: [{ $ifNull: ['$failedLoginAttempts', 0] }, 1] },
          ],
        } } },
        { $set: { lockedUntil: {
          $cond: [
            { $gte: ['$failedLoginAttempts', maxAttempts] },
            new Date(now.getTime() + lockoutMinutes * 60_000),
            null,
          ],
        } } },
      ],
      { new: true },
    ).exec();
    return Boolean(user?.lockedUntil && user.lockedUntil.getTime() > now.getTime());
  }

  async resetFailedLogins(userId: string, expectedPasswordHash: string): Promise<boolean> {
    const result = await this.users.updateOne(
      { _id: userId, status: 'active', passwordHash: expectedPasswordHash, lockedUntil: { $not: { $gt: new Date() } } },
      { $set: { failedLoginAttempts: 0, lockedUntil: null } },
    ).exec();
    return result.matchedCount === 1;
  }

  async updatePassword(userId: string, passwordHash: string, expectedPasswordHash?: string): Promise<void> {
    const result = await this.users.updateOne(
      { _id: userId, status: 'active', ...(expectedPasswordHash !== undefined ? { passwordHash: expectedPasswordHash } : {}) },
      { $set: { passwordHash, mustChangePassword: false }, $inc: { sessionVersion: 1 } },
    ).exec();
    if (result.matchedCount === 0) {
      if (expectedPasswordHash === undefined) throw new NotFoundException('User not found');
      throw new UnauthorizedException('Account or password has changed; sign in again');
    }
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<PublicUser> {
    const updated = await this.users.findOneAndUpdate(
      { _id: userId, status: 'active' },
      { $set: {
        ...(dto.fullName !== undefined ? { fullName: dto.fullName.trim() } : {}),
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.preferredCurrency !== undefined ? { preferredCurrency: dto.preferredCurrency } : {}),
      } },
      { new: true, runValidators: true },
    ).exec();
    if (!updated) throw new NotFoundException('User not found');
    return UsersService.view(updated);
  }

  async deactivate(userId: string): Promise<void> {
    const result = await this.users.updateOne(
      { _id: userId, status: 'active' },
      { $set: { status: 'deactivated' }, $inc: { sessionVersion: 1 } },
    ).exec();
    if (result.matchedCount === 0) throw new NotFoundException('User not found');
  }
}
