import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, FilterQuery, Model } from 'mongoose';
import { AuditLog, AuditLogDocument, AuditOutcome } from './schemas/audit-log.schema';
import { AuditLogDto, AuditLogsPageDto, AuditLogsQueryDto } from './dto/audit-logs.dto';

export interface AppendAuditLogInput {
  eventId: string;
  actorId?: string | null;
  action: string;
  resourceType: string;
  resourceId: string;
  occurredAt: Date;
  correlationId?: string | null;
  outcome: AuditOutcome;
  metadata?: Record<string, string | number | boolean | null>;
}

const SENSITIVE_METADATA_KEY = /(password|token|secret|credential|card|email|phone|address|full.?name)/i;

@Injectable()
export class AuditLoggingService {
  constructor(@InjectModel(AuditLog.name) private readonly auditLogs: Model<AuditLog>) {}

  async append(input: AppendAuditLogInput, session?: ClientSession): Promise<AuditLogDto> {
    const metadata = this.sanitizeMetadata(input.metadata);
    const filter = { eventId: input.eventId };
    try {
      const auditLog = await this.auditLogs.findOneAndUpdate(
        filter,
        { $setOnInsert: {
          ...input,
          actorId: input.actorId ?? null,
          correlationId: input.correlationId ?? null,
          metadata: metadata ? Object.fromEntries(metadata) : undefined,
        } },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true, ...(session ? { session } : {}) },
      ).exec();
      return AuditLoggingService.view(auditLog);
    } catch (error: unknown) {
      if (!session && typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
        const existing = await this.auditLogs.findOne(filter).exec();
        if (existing) return AuditLoggingService.view(existing);
      }
      throw error;
    }
  }

  async list(query: AuditLogsQueryDto): Promise<AuditLogsPageDto> {
    if (query.from && query.to && new Date(query.from).getTime() > new Date(query.to).getTime()) {
      throw new BadRequestException('from must be earlier than or equal to to');
    }

    const filter: FilterQuery<AuditLog> = {};
    if (query.actorId) filter.actorId = query.actorId;
    if (query.action) filter.action = query.action;
    if (query.resourceType) filter.resourceType = query.resourceType;
    if (query.resourceId) filter.resourceId = query.resourceId;
    if (query.outcome) filter.outcome = query.outcome;
    if (query.from || query.to) {
      filter.occurredAt = {
        ...(query.from ? { $gte: new Date(query.from) } : {}),
        ...(query.to ? { $lte: new Date(query.to) } : {}),
      };
    }

    const direction = query.order === 'asc' ? 1 : -1;
    const [rows, total] = await Promise.all([
      this.auditLogs.find(filter)
        .sort({ occurredAt: direction, _id: direction })
        .skip((query.page - 1) * query.limit)
        .limit(query.limit)
        .exec(),
      this.auditLogs.countDocuments(filter).exec(),
    ]);
    return {
      data: rows.map(AuditLoggingService.view),
      meta: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    };
  }

  private sanitizeMetadata(metadata?: AppendAuditLogInput['metadata']): Map<string, string | number | boolean | null> | undefined {
    if (!metadata) return undefined;
    const safe = new Map<string, string | number | boolean | null>();
    for (const [key, value] of Object.entries(metadata)) {
      if (SENSITIVE_METADATA_KEY.test(key)) continue;
      if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) continue;
      if (typeof value === 'string') safe.set(key, value.slice(0, 250));
      else if (typeof value === 'number' && Number.isFinite(value)) safe.set(key, value);
      else if (typeof value === 'boolean' || value === null) safe.set(key, value);
    }
    return safe.size ? safe : undefined;
  }

  private static view(auditLog: AuditLogDocument | null): AuditLogDto {
    if (!auditLog) throw new Error('Audit record was not returned after persistence');
    const metadata = auditLog.metadata ? Object.fromEntries(auditLog.metadata) as Record<string, string | number | boolean | null> : undefined;
    return {
      id: auditLog._id.toString(),
      eventId: auditLog.eventId,
      actorId: auditLog.actorId ?? null,
      action: auditLog.action,
      resourceType: auditLog.resourceType,
      resourceId: auditLog.resourceId,
      occurredAt: auditLog.occurredAt,
      correlationId: auditLog.correlationId ?? null,
      outcome: auditLog.outcome,
      ...(metadata ? { metadata } : {}),
    };
  }
}
