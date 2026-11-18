import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AdminOutboxEvent, AdminOutboxEventSchema } from '../administration/schemas/admin-outbox.schema';
import { AuditLoggingController } from './audit-logging.controller';
import { AuditLoggingService } from './audit-logging.service';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { AdminOutboxConsumer } from './admin-outbox-consumer';

@Module({
  imports: [AuthModule, MongooseModule.forFeature([
    { name: AuditLog.name, schema: AuditLogSchema },
    { name: AdminOutboxEvent.name, schema: AdminOutboxEventSchema },
  ])],
  controllers: [AuditLoggingController],
  providers: [AuditLoggingService, AdminOutboxConsumer],
  exports: [AuditLoggingService],
})
export class AuditLoggingModule {}
