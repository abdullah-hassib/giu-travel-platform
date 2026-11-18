import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model, Types } from 'mongoose';
import { Notification, NotificationDocument } from './schemas/notification.schema';
import { CreateNotificationDto, NotificationDto, NotificationListQueryDto, NotificationPageDto } from './dto/notifications.dto';

@Injectable()
export class NotificationsService {
  constructor(@InjectModel(Notification.name) private readonly notifications: Model<Notification>) {}

  async create(input: CreateNotificationDto, session?: ClientSession): Promise<NotificationDto> {
    if (!Types.ObjectId.isValid(input.recipientId)) throw new BadRequestException('Invalid notification recipient ID');
    const filter = { eventId: input.eventId, recipientId: input.recipientId };
    try {
      const notification = await this.notifications.findOneAndUpdate(
        filter,
        { $setOnInsert: { ...input, readAt: null } },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, ...(session ? { session } : {}) },
      ).exec();
      return NotificationsService.view(notification);
    } catch (error: unknown) {
      if (!session && typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        const existing = await this.notifications.findOne(filter).exec();
        if (existing) return NotificationsService.view(existing);
      }
      throw error;
    }
  }

  async listForUser(recipientId: string, query: NotificationListQueryDto): Promise<NotificationPageDto> {
    const filter: FilterQuery<Notification> = { recipientId };
    if (query.unreadOnly) filter.readAt = null;

    const [data, total] = await Promise.all([
      this.notifications.find(filter)
        .sort({ createdAt: query.order === 'asc' ? 1 : -1, _id: query.order === 'asc' ? 1 : -1 })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .exec(),
      this.notifications.countDocuments(filter).exec(),
    ]);
    return {
      data: data.map(NotificationsService.view),
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  unreadCount(recipientId: string): Promise<number> {
    return this.notifications.countDocuments({ recipientId, readAt: null }).exec();
  }

  async markAsRead(recipientId: string, notificationId: string): Promise<NotificationDto> {
    const updated = await this.notifications.findOneAndUpdate(
      { _id: notificationId, recipientId, readAt: null },
      { $set: { readAt: new Date() } },
      { new: true },
    ).exec();
    const notification = updated ?? await this.notifications.findOne({ _id: notificationId, recipientId }).exec();
    if (!notification) throw new NotFoundException('Notification not found');
    return NotificationsService.view(notification);
  }

  private static view(notification: NotificationDocument | null): NotificationDto {
    if (!notification) throw new NotFoundException('Notification not found');
    const readAt = notification.readAt ?? null;
    return {
      id: notification._id.toString(),
      eventType: notification.eventType,
      message: notification.message,
      resourceType: notification.resourceType,
      resourceId: notification.resourceId,
      createdAt: notification.createdAt,
      readAt,
      isRead: readAt !== null,
    };
  }
}
