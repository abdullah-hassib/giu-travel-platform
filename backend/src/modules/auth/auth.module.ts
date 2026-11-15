import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { UsersController } from './users.controller';
import { AuthService } from './auth.service';
import { SessionGuard } from './security/session.guard';
import { RolesGuard } from './security/roles.guard';
import { UserSession, UserSessionSchema } from './schemas/user-session.schema';

@Module({
  imports: [UsersModule, MongooseModule.forFeature([{ name: UserSession.name, schema: UserSessionSchema }])],
  controllers: [AuthController, UsersController],
  providers: [AuthService, SessionGuard, RolesGuard],
  exports: [AuthService, SessionGuard, RolesGuard],
})
export class AuthModule {}
