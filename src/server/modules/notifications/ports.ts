import type { NotificationPreferenceDto } from "@/contracts/notifications-api";
import type { NotificationDto, NotificationType } from "@/contracts/notifications";
import type { AuditRepository } from "@/server/ports/core-repositories";

/** Keyset position for paging (newest first). */
export interface NotificationCursor {
  createdAt: Date;
  id: string;
}

export interface NotificationFilter {
  userId: string;
  /** Restrict to this workspace plus platform-wide (null workspace) notifications. */
  workspaceId?: string;
  unreadOnly?: boolean;
  type?: NotificationType;
}

export interface NotificationCenterRepository {
  list(
    filter: NotificationFilter,
    page: { limit: number; before?: NotificationCursor },
  ): Promise<NotificationDto[]>;
  unreadCount(filter: Pick<NotificationFilter, "userId" | "workspaceId">): Promise<number>;
  /** Marks the user's own unread notifications read; `ids: null` means all matching. */
  markRead(
    filter: Pick<NotificationFilter, "userId" | "workspaceId">,
    ids: readonly string[] | null,
    at: Date,
  ): Promise<number>;
  listPreferences(userId: string): Promise<NotificationPreferenceDto[]>;
  upsertPreferences(userId: string, prefs: readonly NotificationPreferenceDto[]): Promise<void>;
  /** Upsert by endpoint: a browser endpoint belongs to the user who registered it last. */
  upsertPushSubscription(input: {
    userId: string;
    endpoint: string;
    keys: { p256dh: string; auth: string };
    userAgent: string | null;
  }): Promise<void>;
  /** Deletes only the user's own subscription; returns whether one was removed. */
  deletePushSubscription(userId: string, endpoint: string): Promise<boolean>;
}

export interface NotificationRepos {
  notifications: NotificationCenterRepository;
  audit: AuditRepository;
}
