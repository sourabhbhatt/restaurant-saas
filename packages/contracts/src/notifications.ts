export const NOTIFICATION_TYPES = [
  "order.created",
  "order.accepted",
  "order.rejected",
  "order.ready",
  "bill.requested",
  "payment.recorded",
  "staff.invited",
  "trial.reminder",
  "trial.expired",
  "subscription.activated",
  "subscription.upgrade_rejected",
  "subscription.expired",
  "platform.announcement",
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export interface NotificationInput {
  type: NotificationType;
  title: string;
  body?: string | null;
  /** Safe ids only (orderId, branchId, ...) for deep links. */
  data?: Record<string, string | number | null>;
}

export interface NotificationDto {
  id: string;
  type: NotificationType;
  title: string;
  body: string | null;
  data: Record<string, unknown>;
  workspaceId: string | null;
  branchId: string | null;
  readAt: string | null;
  createdAt: string;
}
