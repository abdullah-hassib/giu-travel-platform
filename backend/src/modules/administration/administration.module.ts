import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { User, UserSchema } from '../users/schemas/user.schema';
import { AdministrationController } from './administration.controller';
import { AdministrationService } from './administration.service';

@Module({
  imports: [AuthModule, MongooseModule.forFeature([{ name: User.name, schema: UserSchema }])],
  controllers: [AdministrationController],
  providers: [AdministrationService],
})
export class AdministrationModule {}
