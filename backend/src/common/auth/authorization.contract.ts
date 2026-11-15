/** Provisional interfaces only. No authorization decisions are implemented. */
export type UserId = string; // MongoDB ObjectId encoded as 24 hex chars; validate at API boundary.
export type ProviderId = string;
export type UserRole = 'traveler' | 'admin' | 'airline_moderator' | 'hotel_moderator'; // Roles derived from official PDF; naming subject to review
export interface AuthPrincipal { userId: UserId; roles: readonly UserRole[]; }
export interface ResourceAccessContext { principal: AuthPrincipal; resourceType: string; resourceId?: string; providerId?: ProviderId; action: 'create' | 'read' | 'update' | 'delete' | 'manage'; }
export interface AuthorizationPolicy { canAccess(context: ResourceAccessContext): Promise<boolean>; }
export interface ModeratorProviderAssignment {
  moderatorId: UserId;
  providerType: 'airline' | 'hotel';
  providerId: ProviderId;
  assignedAt: Date;
  assignedBy: UserId;
  active: boolean;
  /** Enforce exactly one active provider per moderator; exact persistence model awaits workbook. */
}
