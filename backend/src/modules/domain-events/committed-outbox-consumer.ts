import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { ClientSession, Connection, Model } from 'mongoose';
import { OutboxEvent, OUTBOX_EVENT_TYPES } from '../../common/events/outbox-event.schema';
import { ModeratorAssignment } from '../administration/schemas/moderator-assignment.schema';
import { AuditLoggingService } from '../audit-logging/audit-logging.service';
import { HotelBooking } from '../hotel-bookings/schemas/hotel-booking.schema';
import { NotificationsService } from '../notifications/notifications.service';
import { RefundOutbox } from '../refunds/schemas/refund-outbox.schema';

/** Adapt existing owners' committed envelopes without changing their producers. */
@Injectable()
export class CommittedOutboxConsumer implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CommittedOutboxConsumer.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(OutboxEvent.name) private readonly events: Model<OutboxEvent>,
    @InjectModel(RefundOutbox.name) private readonly refunds: Model<RefundOutbox>,
    @InjectModel(HotelBooking.name) private readonly bookings: Model<HotelBooking>,
    @InjectModel(ModeratorAssignment.name) private readonly assignments: Model<ModeratorAssignment>,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditLoggingService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>('NODE_ENV') === 'test') return;
    this.timer = setInterval(() => void this.poll(), 5_000);
    this.timer.unref();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  async consumePending(): Promise<number> {
    let consumed = 0;
    // Independent bounded batches prevent a busy hotel queue starving refunds.
    for (const source of ['domain', 'refund'] as const) {
      for (let index = 0; index < 50; index += 1) {
        let processed = false;
        await this.connection.transaction(async (session) => {
          processed = false;
          if (source === 'domain') {
            const event = await this.events.findOneAndUpdate(
              { status: 'pending', version: 1, type: { $in: OUTBOX_EVENT_TYPES } },
              { $set: { status: 'delivered' } },
              { new: true, session, sort: { occurredAt: 1, id: 1 } },
            ).exec();
            if (!event) return;
            await this.deliverDomain(event, session);
          } else {
            const event = await this.refunds.findOneAndUpdate(
              { status: 'pending', version: 1, type: 'refund.status_changed' },
              { $set: { status: 'delivered' } },
              { new: true, session, sort: { occurredAt: 1, id: 1 } },
            ).exec();
            if (!event) return;
            const payload = event.payload;
            await this.notifications.create({
              eventId: event.id, recipientId: payload.recipientUserId,
              eventType: event.type, resourceType: 'refund', resourceId: payload.refundId,
              message: `Your ${payload.bookingType} booking refund (${payload.currency} ${(payload.amountMinor / 100).toFixed(2)}) is ${payload.refundStatus}.`,
            }, session);
            await this.audit.append({
              eventId: event.id, action: event.type, resourceType: 'refund', resourceId: payload.refundId,
              occurredAt: new Date(event.occurredAt), correlationId: event.correlationId,
              outcome: 'success', metadata: { status: payload.refundStatus },
            }, session);
          }
          processed = true;
        });
        if (!processed) break;
        consumed += 1;
      }
    }
    return consumed;
  }

  private async deliverDomain(event: OutboxEvent, session: ClientSession): Promise<void> {
    const payload = event.payload;
    let resourceType: string;
    let resourceId: string;
    if (event.type.startsWith('hotel_booking.')) {
      resourceType = 'hotel-booking';
      resourceId = this.field(payload, 'bookingId');
      const confirmed = event.type === 'hotel_booking.confirmed';
      const reference = typeof payload.reference === 'string' ? ` ${payload.reference}` : '';
      const details = confirmed ? ` at ${this.field(payload, 'hotelName')}, ${this.field(payload, 'checkIn')} to ${this.field(payload, 'checkOut')}` : '';
      await this.notifications.create({
        eventId: event.id, recipientId: this.field(payload, 'userId'),
        eventType: confirmed ? 'booking.confirmed' : 'booking.cancelled', resourceType, resourceId,
        message: `Your hotel booking${reference}${details} is ${confirmed ? 'Confirmed' : 'Cancelled'}.`.slice(0, 500),
      }, session);
    } else if (event.type.startsWith('hotel.')) {
      resourceType = 'hotel';
      resourceId = this.field(payload, 'hotelId');
      const moderators = await this.assignments.find({ providerType: 'hotel', providerId: resourceId }).session(session).lean();
      const recipients = new Set(moderators.map((assignment) => assignment.userId.toString()));
      if (event.type === 'hotel.deactivated') {
        const bookings = await this.bookings.find({ hotelId: resourceId, status: 'Confirmed', checkOut: { $gte: new Date().toISOString().slice(0, 10) } }).select('userId').session(session).lean();
        for (const booking of bookings) recipients.add(booking.userId.toString());
      }
      for (const recipientId of recipients) {
        await this.notifications.create({
          eventId: event.id, recipientId, eventType: event.type === 'hotel.deactivated' ? 'provider.deactivated' : 'provider.reactivated',
          resourceType, resourceId,
          message: event.type === 'hotel.deactivated'
            ? 'This hotel has been deactivated. Existing Confirmed bookings remain valid.'
            : 'This hotel has been reactivated.',
        }, session);
      }
    } else {
      resourceType = event.type === 'moderation.report_dismissed' ? 'report' : this.field(payload, 'targetType');
      resourceId = this.field(payload, event.type === 'moderation.report_dismissed' ? 'reportId' : 'targetId');
    }
    await this.audit.append({
      eventId: event.id, actorId: event.actorId, action: event.type, resourceType, resourceId,
      occurredAt: new Date(event.occurredAt), correlationId: event.correlationId,
      outcome: 'success', metadata: { eventVersion: event.version },
    }, session);
  }

  private field(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];
    if (typeof value !== 'string' || !value.trim()) throw new Error('Committed event has an invalid required field');
    return value;
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await this.consumePending(); }
    catch { this.logger.warn('Committed event delivery failed; events remain pending for retry'); }
    finally { this.running = false; }
  }
}
