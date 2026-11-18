import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { AdminOutboxEvent, AdminOutboxEventSchema } from '../administration/schemas/admin-outbox.schema';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditLoggingService } from './audit-logging.service';
import { AuditLog, AuditLogSchema } from './schemas/audit-log.schema';
import { AdminOutboxConsumer } from './admin-outbox-consumer';

@Module({
  imports: [AuthModule, NotificationsModule, MongooseModule.forFeature([
    { name: AuditLog.name, schema: AuditLogSchema },
    { name: AdminOutboxEvent.name, schema: AdminOutboxEventSchema },
  ])],
  providers: [AuditLoggingService, AdminOutboxConsumer],
  exports: [AuditLoggingService],
})
export class AuditLoggingModule {}
