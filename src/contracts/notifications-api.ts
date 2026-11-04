import { z } from "zod";

import { NOTIFICATION_TYPES, type NotificationDto, type NotificationType } from "./notifications";

/**
 * Notification center + push subscription API contracts
 * (`/api/v1/notifications*`, `/api/v1/push/*`, `/api/v1/sync/ping`).
 */

const booleanQuery = z
  .enum(["true", "false", "1", "0"])
  .optional()
  .transform((v) => v === "true" || v === "1");

export const listNotificationsQuerySchema = z.object({
  /** Only unread notifications. */
  unread: booleanQuery,
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** Opaque cursor from a previous page's `nextCursor`. */
  cursor: z.string().min(1).max(200).optional(),
  /**
   * Restrict to one workspace (membership is verified). Platform-wide
   * notifications (no workspace) are included as well.
   */
  workspaceId: z.uuid({ message: "Invalid workspace" }).optional(),
  type: z.enum(NOTIFICATION_TYPES).optional(),
});
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;

export interface NotificationListDto {
  items: NotificationDto[];
  nextCursor: string | null;
  /** Unread count for the same workspace filter (ignores `unread`/`type`/`cursor`). */
  unreadCount: number;
}

export const markNotificationsReadSchema = z
  .object({
    ids: z.array(z.uuid({ message: "Invalid notification id" })).min(1).max(200).optional(),
    all: z.boolean().optional(),
    /** With `all`: only mark this workspace's (and platform-wide) notifications. */
    workspaceId: z.uuid({ message: "Invalid workspace" }).optional(),
  })
  .refine((v) => Boolean(v.all) !== Boolean(v.ids), {
    message: "Pass either a list of ids or all: true",
    path: ["ids"],
  });
export type MarkNotificationsReadInput = z.infer<typeof markNotificationsReadSchema>;

export interface MarkNotificationsReadResult {
  updated: number;
  unreadCount: number;
}

export interface NotificationPreferenceDto {
  type: NotificationType;
  inApp: boolean;
  email: boolean;
  push: boolean;
}

export const notificationPreferenceSchema = z.object({
  type: z.enum(NOTIFICATION_TYPES, { message: "Unknown notification type" }),
  inApp: z.boolean(),
  email: z.boolean(),
  push: z.boolean(),
});

export const updateNotificationPreferencesSchema = z.object({
  preferences: z
    .array(notificationPreferenceSchema)
    .min(1, "Choose at least one preference")
    .max(NOTIFICATION_TYPES.length)
    .refine((list) => new Set(list.map((p) => p.type)).size === list.length, {
      message: "Each notification type can appear only once",
    }),
});
export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;

export const pushSubscriptionSchema = z.object({
  endpoint: z
    .url({ message: "Invalid push endpoint" })
    .max(2048)
    .refine((u) => u.startsWith("https://"), { message: "Push endpoint must use https" }),
  keys: z.object({
    p256dh: z.string().min(1).max(256),
    auth: z.string().min(1).max(128),
  }),
});
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;

export const deletePushSubscriptionSchema = z.object({
  endpoint: z.url({ message: "Invalid push endpoint" }).max(2048),
});

export interface PushConfigDto {
  enabled: boolean;
  publicKey: string | null;
}

export interface SyncPingDto {
  ok: true;
  serverTime: string;
}

/** Human labels for notification types (preferences UI, filters). */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  "order.created": "New orders",
  "order.accepted": "Orders accepted",
  "order.rejected": "Orders rejected",
  "order.ready": "Orders ready to serve",
  "bill.requested": "Bill requests",
  "payment.recorded": "Payments recorded",
  "staff.invited": "Staff invitations",
  "trial.reminder": "Trial reminders",
  "trial.expired": "Trial expired",
  "subscription.activated": "Subscription activated",
  "subscription.expired": "Subscription expired",
  "platform.announcement": "Platform announcements",
};
