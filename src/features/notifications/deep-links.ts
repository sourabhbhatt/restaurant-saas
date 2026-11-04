import type { NotificationDto } from "@/contracts/notifications";

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
