import {
  BadGatewayException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { Connection, Model, Types } from 'mongoose';
import { randomUUID } from 'node:crypto';
import { User } from '../users/schemas/user.schema';
import { hashPassword } from '../auth/security/password';
import { AdminOutboxEvent } from './schemas/admin-outbox.schema';
import { ModeratorAssignment } from './schemas/moderator-assignment.schema';
import { AdministrationProviderAdapters } from './provider-administration.adapter';
import {
  CreateModeratorDto,
  ModeratorCreatedDto,
} from './dto/create-moderator.dto';

@Injectable()
export class ModeratorProvisioningService {
  constructor(
    @InjectModel(User.name) private readonly users: Model<User>,
    @InjectModel(ModeratorAssignment.name)
    private readonly assignments: Model<ModeratorAssignment>,
    @InjectModel(AdminOutboxEvent.name)
    private readonly outbox: Model<AdminOutboxEvent>,
    @InjectConnection() private readonly connection: Connection,
    private readonly providers: AdministrationProviderAdapters,
  ) {}

  async create(
    actorId: string,
    dto: CreateModeratorDto,
  ): Promise<ModeratorCreatedDto> {
    const kind = dto.role === 'airline_moderator' ? 'airline' : 'hotel';
    const adapter = this.providers.forKind(kind);
    const passwordHash = await hashPassword(dto.password);
    const eventId = randomUUID();
    try {
      return await this.connection.transaction(async (session) => {
        const provider = await adapter.lockExisting(dto.providerId, session);
        if (
          !provider ||
          provider.kind !== kind ||
          typeof provider.id !== 'string' ||
          provider.id.toLowerCase() !== dto.providerId
        )
          throw new BadGatewayException(
            'Provider integration returned a mismatched provider',
          );
        if (await this.users.exists({ email: dto.email }).session(session))
          throw new ConflictException('Email is already registered');
        const [user] = await this.users.create(
          [
            {
              email: dto.email,
              fullName: dto.fullName,
              passwordHash,
              roles: [dto.role],
              status: 'active',
              mustChangePassword: true,
            },
          ],
          { session },
        );
        const [assignment] = await this.assignments.create(
          [
            {
              userId: user._id,
              providerType: kind,
              providerId: new Types.ObjectId(dto.providerId),
              assignedBy: new Types.ObjectId(actorId),
            },
          ],
          { session },
        );
        await this.outbox.create(
          [
            {
              id: eventId,
              type: 'moderator.created',
              version: 1,
              occurredAt: new Date().toISOString(),
              correlationId: eventId,
              actorId,
              payload: {
                targetUserId: user._id.toString(),
                providerType: kind,
                providerId: dto.providerId,
                assignmentId: assignment._id.toString(),
              },
              status: 'pending',
            },
          ],
          { session },
        );
        return {
          id: user._id.toString(),
          email: user.email,
          fullName: user.fullName,
          role: dto.role,
          providerType: kind,
          providerId: dto.providerId,
          mustChangePassword: true,
        };
      });
    } catch (error: unknown) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      )
        throw new ConflictException(
          'Email or moderator assignment is already registered',
        );
      throw error;
    }
  }
}
