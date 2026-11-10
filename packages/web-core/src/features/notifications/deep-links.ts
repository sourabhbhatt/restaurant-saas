import type { NotificationDto } from "@ros/contracts/notifications";

import { appHref, type AppLinks } from "../../app-links";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

/**
 * Where a notification leads. Only ids are taken from `data` (validated as
 * UUIDs), so a notification can never link off-site. The destination page
 * re-checks permissions on the server.
 */
export function notificationHref(
  n: Pick<NotificationDto, "type" | "data" | "branchId" | "workspaceId">,
): string | null {
  const data = n.data ?? {};
  const branchId = id(n.branchId) ?? id(data.branchId);
  const workspaceId = id(n.workspaceId) ?? id(data.workspaceId);

  if (n.type.startsWith("subscription.") || n.type.startsWith("trial.")) {
    return workspaceId ? `/app/w/${workspaceId}/subscription` : null;
  }
  if (n.type === "bill.requested" || n.type === "payment.recorded" || data.billId) {
    return branchId ? `/cashier/${branchId}` : null;
  }
  if (n.type.startsWith("order.") || data.orderId) {
    return branchId ? `/waiter/${branchId}` : null;
  }
  if (n.type === "staff.invited") {
    return workspaceId ? `/app/w/${workspaceId}` : "/app";
  }
  return null;
}

/** Staff consoles live in the ops app; everything else is a console page. */
const OPS_PATH = /^\/(waiter|kitchen|cashier)\//;

/** Absolute link for a notification, on whichever app serves its page. */
export function notificationUrl(
  n: Pick<NotificationDto, "type" | "data" | "branchId" | "workspaceId">,
  links: AppLinks,
): string | null {
  const path = notificationHref(n);
  if (!path) return null;
  return appHref(OPS_PATH.test(path) ? links.ops : links.console, path);
}
