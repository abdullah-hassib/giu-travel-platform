import { ClientSession } from 'mongoose';

export const REPORT_TARGET_TYPES = [
  'post',
  'comment',
  'review',
  'itinerary',
] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export type ModerationAction = 'hide' | 'delete';

/** What GEN-09/GEN-10 need from each kind of user content. */
export interface ModeratedContent {
  /** A visible item's author and a short preview for admins; 404 when missing or hidden. */
  findReportable(id: string): Promise<{ authorId: string; preview: string }>;
  /** Hide or delete the item inside the moderation transaction; 404 when missing. */
  moderate(
    id: string,
    action: ModerationAction,
    session: ClientSession,
  ): Promise<{ authorId: string; imageIdsToDelete?: string[] }>;
}

export function preview(text: string, length = 200): string {
  const clean = text.trim().replace(/\s+/g, ' ');
  return clean.length > length ? `${clean.slice(0, length - 1)}…` : clean;
}
