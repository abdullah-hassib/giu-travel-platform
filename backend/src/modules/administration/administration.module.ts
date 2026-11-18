import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdministrationController } from './administration.controller';
import { AdministrationService } from './administration.service';
import { UserSession, UserSessionSchema } from '../auth/schemas/user-session.schema';
import { AdminOutboxEvent, AdminOutboxEventSchema } from './schemas/admin-outbox.schema';
import { ModeratorAssignmentsModule } from './moderator-assignments.module';
import { ModeratorProvisioningService } from './moderator-provisioning.service';
import { ADMINISTRATION_PROVIDER_ADAPTERS, AdministrationProviderAdapters } from './provider-administration.adapter';

@Module({
  imports: [AuthModule, ModeratorAssignmentsModule, MongooseModule.forFeature([
    { name: User.name, schema: UserSchema },
    { name: UserSession.name, schema: UserSessionSchema },
    { name: AdminOutboxEvent.name, schema: AdminOutboxEventSchema },
  ])],
  controllers: [AdministrationController],
  providers: [AdministrationService, ModeratorProvisioningService, AdministrationProviderAdapters,
    { provide: ADMINISTRATION_PROVIDER_ADAPTERS, useValue: [] }],
})
export class AdministrationModule {}
